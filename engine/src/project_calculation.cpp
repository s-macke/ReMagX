#include "remagx/project_calculation.hpp"
#include "remagx/core.h"
#include "remagx/compound_layers.hpp"
#include "project_segmentation.hpp"
#include "project_elements.hpp"
#include <numeric>
#include <algorithm>
#include <array>
#include <cmath>
#include <string>
#include <set>

namespace remagx {
namespace {
void status_check(int status) {
    if (status == REMAGX_SUCCESS) return;
    if (status == REMAGX_QZ_ERROR) throw ProjectDocumentError("Qz exceeds the solver boundary.");
    if (status == REMAGX_ALLOCATION_ERROR) throw ProjectDocumentError("Insufficient calculation memory.");
    if (status == REMAGX_NUMERICAL_ERROR) throw ProjectDocumentError("Numerical calculation failed; check optical constants and scan settings.");
    throw ProjectDocumentError("Invalid prepared calculation arguments.");
}
void require(bool condition, const char* message) {
    if (!condition) throw ProjectDocumentError(message);
}
RemagxBeam beam(const ProjectDocument& project, const std::string& path) {
    return {project.number(path + "/sigma/re"), project.number(path + "/sigma/im"),
            project.number(path + "/pi/re"), project.number(path + "/pi/im")};
}
bool pure_pi(const RemagxBeam& value) {
    return value.sigma_real == 0 && value.sigma_imaginary == 0 && value.pi_real == 1 && value.pi_imaginary == 0;
}
void finite_column(const std::vector<double>& column) {
    for (double value : column) require(std::isfinite(value), "Calculated curve exceeds the finite double range.");
}
void average(std::vector<double>& values, size_t width) {
    if (!width) return;
    const auto source = values;
    for (size_t index = 0; index < source.size(); ++index) {
        // Preserve the original unsigned-window behavior at the left boundary.
        if (index < width) { values[index] = 0; continue; }
        const size_t start = index - width, end = std::min(source.size() - 1, index + width);
        double sum = 0;
        for (size_t neighbor = start; neighbor <= end; ++neighbor) sum += source[neighbor];
        values[index] = sum / static_cast<double>(end - start + 1);
    }
}
std::vector<double> terminal_coordinates(const ProjectDocument& project) {
    ProjectCurve result;
    if (project.boolean("/experiment/qzScan/useDatasetPoints")) {
        require(!project.is_null("/activeDatasetIndex"), "Dataset-point calculation needs an active dataset.");
        const double selected = project.number("/activeDatasetIndex");
        require(selected < static_cast<double>(project.array_size("/datasets")), "Active dataset index is out of range.");
        const std::string dataset = "/datasets/" + std::to_string(static_cast<size_t>(selected));
        const size_t count = project.array_size(dataset + "/columns/qz");
        require(count > 0 && count <= 1000000, "Dataset calculation requires 1 to 1,000,000 points.");
        const double shift = project.number(dataset + "/qzShift");
        result.qz.reserve(count);
        for (size_t index = 0; index < count; ++index)
            result.qz.push_back(project.number(dataset + "/columns/qz/" + std::to_string(index)) + shift);
    } else {
        const double count_value = project.number("/experiment/qzScan/points");
        require(count_value >= 2 && count_value <= 1000000, "A terminal qz grid requires 2 to 1,000,000 points.");
        const auto count = static_cast<size_t>(count_value);
        const double maximum = project.number("/experiment/qzScan/qzMax");
        result.qz.reserve(count);
        // ReMagX_Terminal.cpp ButtonReflectivity/ButtonDicReflectivity ignores qzMin.
        for (size_t index = 0; index < count; ++index)
            result.qz.push_back(static_cast<double>(index) / static_cast<double>(count - 1) * maximum);
    }
    finite_column(result.qz);
    return result.qz;
}
enum class CalculationContext { terminal, fit_dataset, fit_energy_sample, energy_point };
struct OpticalState {
    std::vector<RemagxLayer> layers;
    std::vector<std::array<double, 18>> tensors;
    std::vector<bool> retained, anisotropic;
    std::vector<size_t> cursors;
    ElementOpticalState elements;
};

}

static void postprocess_curve(const ProjectDocument& project, ProjectCurve& result,
    const std::vector<RemagxReflectivity>& values, bool dichroic, CalculationContext context,
    const RemagxBeam& correction_first, const RemagxBeam& correction_second,
    double correction_energy, const std::vector<double>& correction_energies = {}) {
    const double average_width = project.number("/calculation/averaging");
    require(std::isfinite(average_width) && average_width >= 0 && std::floor(average_width) == average_width && average_width <= 2147483647.0,
        "Invalid moving-average half-width.");
    const bool fourier = project.boolean("/calculation/postProcessing/fourierTransform");
    result.plus.reserve(values.size()); result.minus.reserve(values.size());
    const bool multiply = project.boolean("/calculation/postProcessing/multiplyByQz4");
    const bool divide = project.boolean("/calculation/postProcessing/divideByCos2ThetaSquared");
    for (size_t index = 0; index < values.size(); ++index) {
        const double qz = result.qz[index];
        const double factor = multiply ? qz * qz * qz * qz : 1;
        double plus = values[index].beam1 * factor, minus = values[index].beam2 * factor;
        if (divide) {
            const double current_energy = correction_energies.empty() ? correction_energy : correction_energies[index];
            const double wave = 2 * 3.14159265358979323846 / (12398.326 / current_energy);
            const double ratio = qz / (2 * wave);
            const double angle = std::abs(ratio) >= 1 ? -1 : std::asin(ratio);
            const double denominator = std::cos(2 * angle) * std::cos(2 * angle);
            if (pure_pi(correction_first)) plus /= denominator;
            if (dichroic && pure_pi(correction_second)) minus /= denominator;
        }
        result.plus.push_back(plus);
        result.minus.push_back(minus);
        if (context != CalculationContext::terminal) {
            const bool difference = project.string("/calculation/asymmetryDefinition") == "difference";
            result.asymmetry.push_back(difference ? plus - minus : plus + minus != 0 ? (plus - minus) / (plus + minus) : 0);
        }
    }
    finite_column(result.plus); finite_column(result.minus);
    finite_column(result.asymmetry);
    average(result.asymmetry, static_cast<size_t>(average_width));
    finite_column(result.asymmetry);
    average(result.plus, static_cast<size_t>(average_width));
    average(result.minus, static_cast<size_t>(average_width));
    finite_column(result.plus); finite_column(result.minus);
    if (fourier) {
        std::vector<double> depths(result.qz.size() / 2), magnitudes(result.qz.size() / 2);
        status_check(remagx_fourier(result.qz.data(), result.plus.data(), result.qz.size(), depths.data(), magnitudes.data()));
        result.qz = std::move(depths);
        result.plus = std::move(magnitudes);
        result.minus.assign(result.qz.size(), 0);
    }
}

static ProjectCurve calculate_inner(const ProjectDocument& project, bool dichroic,
    const std::vector<OpticalTable>& tables, const std::vector<double>* coordinates = nullptr,
    double sample_energy = 0, OpticalState* previous = nullptr,
    CalculationContext context = CalculationContext::terminal) {
    const auto algorithm = project.string("/calculation/algorithm");
    require(algorithm == "parratt" || algorithm == "matrix" || algorithm == "zak", "This solver is unavailable in the native terminal.");
    const bool element_mode = project.string("/sample/mode") == "element";
    require(project.string("/experiment/scattering") == "reflection", "Transmission is unavailable in this calculation path.");
    const bool energy_point = context == CalculationContext::energy_point;
    const bool automatic = energy_point || project.boolean("/calculation/automaticOpticalConstants");
    if (project.boolean("/scripts/enabled")) {
        const auto script = project.string("/scripts/beforeCalculation");
        require(script.find_first_not_of(" \t\n\r\f\v") == std::string::npos, "Native terminal BeforeCalculation Lua execution is not integrated yet.");
    }
    const bool segmented = project.string("/calculation/roughnessModel") == "segmentation";
    const bool fourier = project.boolean("/calculation/postProcessing/fourierTransform");
    require(!fourier || !dichroic, "Dichroic Fourier processing remains unavailable pending the legacy column-semantics decision.");
    const double average_width = project.number("/calculation/averaging");
    require(std::isfinite(average_width) && average_width >= 0 && std::floor(average_width) == average_width && average_width <= 2147483647.0, "Moving-average half-width exceeds the supported range.");

    ProjectCurve result;
    // Original terminal creates a default CDataSet or copies the selected one.
    // Its postprocessing metadata are independent of the solver's state beams.
    RemagxBeam correction_first{1, 0, 0, 0}, correction_second{0, 0, 1, 0};
    double correction_energy = 10;
    std::vector<double> correction_energies;
    result.qz = coordinates ? *coordinates : terminal_coordinates(project);
    finite_column(result.qz);
    if (context == CalculationContext::fit_dataset) {
        correction_first = beam(project, "/experiment/polarization/beam1");
        correction_second = beam(project, "/experiment/polarization/beam2");
        correction_energy = project.number("/experiment/energy");
    } else if (!coordinates && project.boolean("/experiment/qzScan/useDatasetPoints")) {
        const auto selected = static_cast<size_t>(project.number("/activeDatasetIndex"));
        const std::string dataset = "/datasets/" + std::to_string(selected);
        const size_t count = result.qz.size();
        correction_first = beam(project, dataset + "/polarization/beam1");
        correction_second = beam(project, dataset + "/polarization/beam2");
        correction_energy = project.number(dataset + "/energy");
        if (project.contains(dataset + "/columns/energy")) {
            correction_energies.reserve(count);
            for (size_t index = 0; index < count; ++index)
                correction_energies.push_back(project.number(dataset + "/columns/energy/" + std::to_string(index)));
        }
    }
    const double energy = coordinates ? sample_energy : project.number("/experiment/energy");
    require(std::isfinite(energy) && energy > 0, "Energy-resolution samples must be positive and finite.");
    const bool fast = !energy_point && project.boolean("/experiment/resolution/fastConvolution");
    if (dichroic && fast) {
        const double wave = 2 * 3.14159265358979323846 / (12398.326 / energy);
        for (double qz : result.qz) require(qz / (wave * 2) < 1, "Qz exceeds the fast dichroic scan boundary.");
    }
    std::vector<RemagxLayer> layers;
    const auto first = beam(project, "/experiment/polarization/beam1");
    const auto second = beam(project, "/experiment/polarization/beam2");
    const auto* second_pointer = dichroic ? &second : nullptr;
    const auto analyzer_name = project.string("/experiment/polarization/analyzer");
    const int analyzer = analyzer_name == "none" ? REMAGX_BOTH : analyzer_name == "sigma" ? REMAGX_SIGMA : REMAGX_PI;
    const int tensor = project.string("/calculation/tensorContribution") == "tetragonal" ? REMAGX_TETRAGONAL : REMAGX_ISOTROPIC;
    const int magnetic = project.string("/calculation/magnetization/mode") == "none" ? 0 : 1;
    const int mode = dichroic ? REMAGX_DICHROIC : REMAGX_MONOCHROMATIC;
    const double width = project.number("/experiment/resolution/angularFwhm");
    std::vector<RemagxMatrixLayer> matrix;
    size_t count = 0;
    if (element_mode) {
        const bool prepared = prepare_project_elements(project, energy, layers, matrix, tables, result.warnings,
            previous ? &previous->elements : nullptr, energy_point);
        if (!prepared) {
            result.plus.assign(result.qz.size(), 1); result.minus.assign(result.qz.size(), dichroic ? 1 : 0);
            return result;
        }
        count = layers.size();
    } else {
        bool range_error = false;
        const size_t stored_count = project.array_size("/sample/layers");
        require(stored_count <= 100000, "Native terminal layer count exceeds the supported limit.");
        std::vector<size_t> indices;
        if (project.boolean("/sample/multilayer/enabled")) {
            indices = compound_layer_indices(stored_count, project.string("/sample/multilayer/pattern"));
        } else {
            indices.resize(stored_count);
            std::iota(indices.begin(), indices.end(), 0);
        }
        count = indices.size();
        std::vector<RemagxLayer> stored_layers;
        const bool continuing = previous && !previous->layers.empty();
        auto tensors = continuing ? previous->tensors : std::vector<std::array<double, 18>>(stored_count);
        auto retained_tensor = continuing ? previous->retained : std::vector<bool>(stored_count, automatic);
        auto anisotropic = continuing ? previous->anisotropic : std::vector<bool>(stored_count, false);
        stored_layers.reserve(stored_count);
        auto cursors = continuing ? previous->cursors : std::vector<size_t>(tables.size(), 0);
        const auto find_table = [&](const std::string& name, const std::string& kind) {
            for (size_t index = 0; index < tables.size(); ++index)
                if (!name.empty() && tables[index].name == name && tables[index].kind == kind) return index;
            return tables.size();
        };
        const double lookup_energy = 12398.326 / (12398.326 / energy);
        const auto read_table = [&](size_t index, size_t width) {
            std::vector<double> values(width, 0);
            if (index == tables.size() || tables[index].energies.empty()) return values;
            const auto& table = tables[index];
            require(table.width == width && table.values.size() == table.energies.size() * width, "Invalid native optical table shape.");
            status_check(remagx_table_lookup(table.energies.data(), table.values.data(), table.energies.size(), width,
                &lookup_energy, 1, &cursors[index], values.data()));
            return values;
        };
        for (size_t index = 0; index < stored_count; ++index) {
            const auto path = "/sample/layers/" + std::to_string(index);
            RemagxLayer layer{project.number(path + "/thickness"), project.number(path + "/roughness"),
                project.number(path + "/delta"), project.number(path + "/beta"),
                project.number(path + "/deltaMag"), project.number(path + "/betaMag"),
                project.number(path + "/magnetization/gamma"), project.number(path + "/magnetization/phi")};
            if (continuing) layer = previous->layers[index];
            if (automatic) {
                if (!continuing && !energy_point && project.contains(path + "/dielectricTensor")) {
                    anisotropic[index] = project.boolean(path + "/dielectricTensor/anisotropic");
                    for (size_t component = 0; component < 18; ++component)
                        tensors[index][component] = project.number(path + "/dielectricTensor/values/" + std::to_string(component));
                }
                const auto name = project.string(path + "/opticalTable");
                const size_t primary = find_table(name, "db");
                if (primary == tables.size() || tables[primary].energies.empty()) {
                    range_error = true;
                    result.warnings.push_back("Layer " + std::to_string(index) + ": missing/empty .db table; saved optical state retained.");
                } else if (lookup_energy < tables[primary].energies.front() || lookup_energy > tables[primary].energies.back()) {
                    range_error = true;
                    result.warnings.push_back("Layer " + std::to_string(index) + ": energy outside .db table; saved optical state retained.");
                } else {
                    const auto scalar = read_table(primary, 2);
                    const auto magnetic = read_table(find_table(name, "m"), 2);
                    layer.delta = scalar[0]; layer.beta = scalar[1];
                    layer.delta_magnetic = magnetic[0]; layer.beta_magnetic = magnetic[1];
                    const size_t tensor_table = find_table(name, "e");
                    retained_tensor[index] = tensor_table != tables.size() && !tables[tensor_table].energies.empty();
                    if (retained_tensor[index]) {
                        const auto values = read_table(tensor_table, 18);
                        std::copy(values.begin(), values.end(), tensors[index].begin());
                        anisotropic[index] = true;
                    }
                }
            }
            stored_layers.push_back(layer);
        }
        if (energy_point && range_error) {
            if (previous) *previous = {std::move(stored_layers), std::move(tensors),
                std::move(retained_tensor), std::move(anisotropic), std::move(cursors), {}};
            result.plus.assign(result.qz.size(), 1); result.minus.assign(result.qz.size(), dichroic ? 1 : 0);
            return result;
        }
        layers.reserve(count);
        for (size_t index : indices) layers.push_back(stored_layers[index]);
        if (algorithm == "matrix") {
            matrix.reserve(count);
            for (size_t position = 0; position < layers.size(); ++position) {
                const auto& layer = layers[position];
                const size_t index = indices[position];
                RemagxMatrixLayer prepared{};
                prepared.thickness = layer.thickness; prepared.roughness = layer.roughness;
                prepared.index_real = 1 - layer.delta; prepared.index_imaginary = layer.beta;
                if (retained_tensor[index]) {
                    std::copy(tensors[index].begin(), tensors[index].end(), prepared.dielectric);
                    prepared.anisotropic = anisotropic[index] ? 1 : 0;
                } else {
                    status_check(remagx_dielectric_tensor(&layer, tensor, magnetic, prepared.dielectric, &prepared.anisotropic));
                }
                matrix.push_back(prepared);
            }
        }
        if (segmented) {
            segment_project_layers(project, layers, matrix);
            count = layers.size();
        }
        if (previous) *previous = {std::move(stored_layers), std::move(tensors),
            std::move(retained_tensor), std::move(anisotropic), std::move(cursors), {}};
    }
    std::vector<RemagxReflectivity> values(result.qz.size());
    if (algorithm == "parratt") {
        status_check(remagx_parratt_qz_resolution(layers.data(), count, result.qz.data(), result.qz.size(), energy,
            &first, second_pointer, tensor, analyzer, magnetic, mode, width, fast, values.data()));
    } else if (algorithm == "zak") {
        status_check(remagx_zak_qz_resolution(layers.data(), count, result.qz.data(), result.qz.size(), energy,
            magnetic, &first, second_pointer, analyzer, mode, width, fast, values.data()));
    } else {
        status_check(remagx_visnovsky_qz_resolution(matrix.data(), count, result.qz.data(), result.qz.size(), energy,
            project.number("/calculation/epsilon"), &first, second_pointer, analyzer, mode, width, fast, values.data()));
    }
    if (context == CalculationContext::energy_point) {
        for (const auto& value : values) { result.plus.push_back(value.beam1); result.minus.push_back(value.beam2); }
    } else postprocess_curve(project, result, values, dichroic, context, correction_first, correction_second,
        correction_energy, correction_energies);
    return result;
}

static ProjectCurve calculate_qz(const ProjectDocument& project, bool dichroic, const std::vector<OpticalTable>& tables,
    const std::vector<double>* fit_coordinates = nullptr) {
    const double width = project.number("/experiment/resolution/energyFwhm");
    if (dichroic || width <= 1e-6) return calculate_inner(project, dichroic, tables, fit_coordinates,
        project.number("/experiment/energy"), nullptr, fit_coordinates ? CalculationContext::fit_dataset : CalculationContext::terminal);
    require(!project.boolean("/calculation/postProcessing/fourierTransform"),
        "Energy broadening with Fourier processing remains unavailable pending review of the original array lengths.");
    // Same active quadrature as angular_resolution.cpp and the web wrapper.
    constexpr double offsets[] = {-2, -1.77777777777778, -1.55555555555556, -1.33333333333333,
      -1.11111111111111, -.888888888888889, -.666666666666667, -.444444444444444,
      -.222222222222222, 0, .222222222222222, .444444444444444, .666666666666667,
      .888888888888889, 1.11111111111111, 1.33333333333333, 1.55555555555556, 1.77777777777778, 2};
    constexpr double weights[] = {.00377799105508597, .00543307167196355, .0113273887261945,
      .0214123599246999, .0366987921471986, .0570286832606567, .0803509037851472,
      .102646753546022, .118893345923233, .124861419919597, .118893345923233,
      .102646753546022, .0803509037851472, .0570286832606567, .0366987921471986,
      .0214123599246999, .0113273887261945, .00543307167196355, .00377799105508597};
    ProjectCurve result;
    result.qz = fit_coordinates ? *fit_coordinates : terminal_coordinates(project);
    result.plus.assign(result.qz.size(), 0);
    result.minus.assign(result.qz.size(), 0);
    const double energy = 12398.326 / (12398.326 / project.number("/experiment/energy"));
    const double wave = 2 * 3.14159265358979323846 / (12398.326 / energy);
    std::vector<double> angles;
    angles.reserve(result.qz.size());
    for (double qz : result.qz) {
        const double ratio = qz / (2 * wave);
        require(std::abs(ratio) < 1, "Qz exceeds the energy-resolution scan boundary.");
        angles.push_back(ratio < 0 ? 0 : std::asin(ratio));
    }
    OpticalState state;
    std::set<std::string> seen_warnings;
    for (size_t sample = 0; sample < 19; ++sample) {
        const double current_energy = energy + offsets[sample] * width;
        require(std::isfinite(current_energy) && current_energy > 0,
            "Energy-resolution samples must be positive and finite.");
        const double current_wave = 2 * 3.14159265358979323846 / (12398.326 / current_energy);
        std::vector<double> coordinates;
        coordinates.reserve(angles.size());
        for (double angle : angles) coordinates.push_back(2 * current_wave * std::sin(angle));
        const auto current = calculate_inner(project, false, tables, &coordinates, current_energy, &state,
            fit_coordinates ? CalculationContext::fit_energy_sample : CalculationContext::terminal);
        require(current.plus.size() == result.plus.size(), "Energy broadening changed the sample array length.");
        for (size_t point = 0; point < result.plus.size(); ++point)
            result.plus[point] += weights[sample] * current.plus[point];
        if (fit_coordinates) { result.minus = current.minus; result.asymmetry = current.asymmetry; }
        for (const auto& warning : current.warnings)
            if (seen_warnings.insert(warning).second) result.warnings.push_back(warning);
    }
    finite_column(result.plus);
    return result;
}

ProjectCurve calculate_terminal_qz(const ProjectDocument& project, bool dichroic, const std::vector<OpticalTable>& tables) {
    return calculate_qz(project, dichroic, tables);
}
ProjectCurve calculate_fit_dataset_qz(const PreparedFitDataset& dataset, const std::vector<OpticalTable>& tables) {
    require(!dataset.energy_scan, "Native fit energy-scan integration is not available yet.");
    require(!dataset.project.boolean("/calculation/postProcessing/fourierTransform"), "Fourier fitting remains unavailable.");
    return calculate_qz(dataset.project, dataset.dichroic, tables, &dataset.measurement.at("qz"));
}

ProjectCurve calculate_fit_dataset(const PreparedFitDataset& dataset, const std::vector<OpticalTable>& tables) {
    if (!dataset.energy_scan) return calculate_fit_dataset_qz(dataset, tables);
    const auto& project = dataset.project;
    require(!project.boolean("/calculation/postProcessing/fourierTransform"), "Fourier fitting remains unavailable.");
    const auto& energies = dataset.measurement.at("energy");
    const auto& coordinates = dataset.measurement.at("qz");
    require(!energies.empty() && energies.size() == coordinates.size(), "Energy scan coordinates must be aligned and nonempty.");
    for (double energy : energies) require(std::isfinite(energy) && energy > 0, "Energy scan requires positive finite energies.");
    const double energy_width = project.number("/experiment/resolution/energyFwhm");
    require(std::isfinite(energy_width) && energy_width >= 0, "Energy resolution must be finite and nonnegative.");
    OpticalState state;
    ProjectCurve result;
    result.qz = coordinates; result.energy = energies;
    std::vector<RemagxReflectivity> raw;
    raw.reserve(energies.size());
    std::set<std::string> seen_warnings;
    for (size_t index = 0; index < energies.size(); ++index) {
        const std::vector<double> point{coordinates[index]};
        const auto current = calculate_inner(project, dataset.dichroic, tables, &point, energies[index], &state, CalculationContext::energy_point);
        raw.push_back({current.plus.at(0), current.minus.at(0)});
        for (const auto& warning : current.warnings)
            if (seen_warnings.insert(warning).second) result.warnings.push_back(warning);
    }
    std::vector<RemagxReflectivity> resolved(raw.size());
    status_check(remagx_energy_resolution(energies.data(), raw.data(), raw.size(), energy_width, resolved.data()));
    postprocess_curve(project, result, resolved, dataset.dichroic, CalculationContext::fit_dataset,
        beam(project, "/experiment/polarization/beam1"), beam(project, "/experiment/polarization/beam2"),
        energies.back(), energies);
    return result;
}
}
