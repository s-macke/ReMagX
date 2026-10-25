#include <optional>
#ifdef REMAGX_NATIVE_LUA
#include "remagx/project_lua.hpp"
#endif
#include "remagx/project_calculation.hpp"
#include "remagx/core.h"
#include "remagx/project_fit.hpp"
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
class ProjectScriptHook;
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
enum class CalculationContext { terminal, fit_dataset, fit_energy_sample, energy_point, refresh_only, strict_refresh };
struct OpticalState {
    std::vector<RemagxLayer> layers;
    std::vector<std::array<double, 18>> tensors;
    std::vector<bool> retained, anisotropic;
    std::vector<size_t> cursors;
    ElementOpticalState elements;
    std::vector<double> layer_depths{};
    std::vector<std::optional<size_t>> resolved_tables{};
};

}

static void postprocess_curve(const ProjectDocument& project, ProjectCurve& result,
    const std::vector<RemagxReflectivity>& values, bool dichroic, CalculationContext context,
    const RemagxBeam& correction_first, const RemagxBeam& correction_second,
    double correction_energy, const std::vector<double>& correction_energies = {}) {
    const double average_width = project.number("/calculation/averaging");
    require(std::isfinite(average_width) && average_width >= 0 && std::floor(average_width) == average_width && average_width <= 2147483647.0,
        "Invalid moving-average half-width.");
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

}

static ProjectCurve calculate_inner(const ProjectDocument& original, bool dichroic,
    const std::vector<OpticalTable>& tables, const std::vector<double>* coordinates = nullptr,
    double sample_energy = 0, OpticalState* previous = nullptr,
    CalculationContext context = CalculationContext::terminal, const ProjectCalculationOptions* options = nullptr,
    ProjectDocument* script_result = nullptr, ProjectScriptHook* persistent_hook = nullptr) {
    (void)options;
    (void)persistent_hook;
    auto project = original;
    const auto algorithm = project.string("/calculation/algorithm");
    require(algorithm == "parratt" || algorithm == "matrix" || algorithm == "zak", "This solver is unavailable in the native terminal.");
    const bool element_mode = project.string("/sample/mode") == "element";
    require(project.string("/experiment/scattering") == "reflection", "Transmission is unavailable in this calculation path.");
    const bool energy_point = context == CalculationContext::energy_point;
    const bool strict_refresh = context == CalculationContext::strict_refresh;
    const bool refresh_only = strict_refresh || context == CalculationContext::refresh_only;
    const bool automatic = energy_point || strict_refresh || project.boolean("/calculation/automaticOpticalConstants");
    const bool scripted = !refresh_only && project.boolean("/scripts/enabled") &&
        project.string("/scripts/beforeCalculation").find_first_not_of(" \t\n\r\f\v") != std::string::npos;
    if (scripted) {
#ifdef REMAGX_NATIVE_LUA
        require(options && (context == CalculationContext::terminal ||
            (persistent_hook && (context == CalculationContext::fit_dataset || context == CalculationContext::fit_energy_sample || context == CalculationContext::energy_point))),
            "Native Lua requires a calculation session.");
#else
        throw ProjectDocumentError("Native terminal was built without Lua support.");
#endif
    }
    const bool segmented = project.string("/calculation/roughnessModel") == "segmentation";
    require(!project.boolean("/calculation/postProcessing/fourierTransform"), "Fourier transformation is excluded from this application. Remove the obsolete Fourier setting before calculating.");
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
    double energy = coordinates ? sample_energy : project.number("/experiment/energy");
    require(std::isfinite(energy) && energy > 0, "Energy-resolution samples must be positive and finite.");
    const bool fast = !energy_point && project.boolean("/experiment/resolution/fastConvolution");
    if (dichroic && fast && !scripted) {
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
    double width = project.number("/experiment/resolution/angularFwhm");
    std::vector<RemagxMatrixLayer> matrix;
    size_t count = 0;
    if (element_mode) {
        ElementOpticalState local_elements;
        auto* element_state = previous ? &previous->elements : &local_elements;
#ifdef REMAGX_NATIVE_LUA
        if (scripted) {
            const bool in_range = prepare_project_elements(project, energy, layers, matrix, tables,
                result.warnings, element_state, energy_point, true);
            if (energy_point && !in_range) {
                result.plus.assign(result.qz.size(),1); result.minus.assign(result.qz.size(),dichroic ? 1 : 0);
                return result;
            }
            std::vector<std::pair<std::string,double>> edits;
            std::vector<std::array<double,18>> scattering(element_state->factors.size());
            for (size_t index = 0; index < scattering.size(); ++index) {
                const auto path = "/sample/elementProfiles/" + std::to_string(index);
                const char* fields[] = {"/f1","/f2","/f1Mag","/f2Mag"};
                for (size_t part = 0; part < 4; ++part) edits.emplace_back(path+fields[part], element_state->factors[index][part]);
                std::copy_n(element_state->tensors.data()+index*18,18,scattering[index].data());
            }
            // The inactive compound film still exposes its stored tensors to Lua.
            std::vector<ScriptDielectricTensor> tensors(project.array_size("/sample/layers"));
            for (size_t index = 0; index < tensors.size(); ++index) {
                const auto path = "/sample/layers/" + std::to_string(index) + "/dielectricTensor";
                if (previous && previous->tensors.size() == tensors.size()) {
                    tensors[index] = {previous->tensors[index], previous->anisotropic[index]};
                } else if (project.contains(path)) {
                    tensors[index].anisotropic = project.boolean(path+"/anisotropic");
                    for (size_t part = 0; part < 18; ++part) tensors[index].values[part] = project.number(path+"/values/"+std::to_string(part));
                }
            }
            const auto emit = options->script_output ? options->script_output : [](const std::string&) {};
            std::unique_ptr<ProjectScriptHook> temporary;
            if (!persistent_hook) temporary = std::make_unique<ProjectScriptHook>(tables,emit,true,options->should_stop);
            auto result = (persistent_hook ? *persistent_hook : *temporary).run(project.with_calculation_numbers(edits),tensors,scattering,element_state->cursors,0,
                previous && !previous->resolved_tables.empty() ? &previous->resolved_tables : nullptr);
            project = std::move(result.project); element_state->cursors = std::move(result.cursors);
            if (previous) {
                previous->resolved_tables = std::move(result.resolved_tables);
                previous->tensors.resize(result.tensors.size()); previous->anisotropic.resize(result.tensors.size());
                for (size_t index = 0; index < result.tensors.size(); ++index) {
                    previous->tensors[index] = result.tensors[index].values;
                    previous->anisotropic[index] = result.tensors[index].anisotropic;
                }
            }
            energy = project.number("/experiment/energy"); width = project.number("/experiment/resolution/angularFwhm");
            for (size_t index = 0; index < scattering.size(); ++index) {
                const auto path = "/sample/elementProfiles/" + std::to_string(index);
                element_state->factors[index] = {project.number(path+"/f1"),project.number(path+"/f2"),
                    project.number(path+"/f1Mag"),project.number(path+"/f2Mag")};
                std::copy(result.scattering[index].begin(),result.scattering[index].end(),element_state->tensors.begin()+index*18);
            }
        }
#endif
        const bool prepared = prepare_project_elements(project, energy, layers, matrix, tables, result.warnings,
            element_state, energy_point, refresh_only, strict_refresh, scripted);
        if (refresh_only) return result;
        if (!prepared) {
            result.plus.assign(result.qz.size(), 1); result.minus.assign(result.qz.size(), dichroic ? 1 : 0);
            return result;
        }
        count = layers.size();
    } else {
        bool range_error = false;
        std::vector<double> script_depths;
        ElementOpticalState script_elements;
        std::vector<std::optional<size_t>> script_resolved_tables;
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
            if (continuing) {
                layer.delta = previous->layers[index].delta;
                layer.beta = previous->layers[index].beta;
                layer.delta_magnetic = previous->layers[index].delta_magnetic;
                layer.beta_magnetic = previous->layers[index].beta_magnetic;
            }
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
        require(!strict_refresh || !range_error, "Strict compound optical refresh requires all primary tables in range.");
        if (refresh_only || (energy_point && range_error)) {
            if (previous) {
                previous->layers = std::move(stored_layers); previous->tensors = std::move(tensors);
                previous->retained = std::move(retained_tensor); previous->anisotropic = std::move(anisotropic);
                previous->cursors = std::move(cursors);
            }
            result.plus.assign(result.qz.size(), 1); result.minus.assign(result.qz.size(), dichroic ? 1 : 0);
            return result;
        }
#ifdef REMAGX_NATIVE_LUA
        if (scripted) {
            if (segmented && previous && !previous->layer_depths.empty()) script_depths = previous->layer_depths;
            else if (segmented) {
                script_depths.assign(stored_count, 0);
                for (size_t index = 1; index < stored_count; ++index) {
                    script_depths[index] = script_depths[index-1] + stored_layers[index].thickness;
                    require(std::isfinite(script_depths[index]), "Stored layer depth exceeds the numerical range.");
                }
            }
            std::vector<std::pair<std::string,double>> edits;
            std::vector<ScriptDielectricTensor> prepared(stored_count);
            for (size_t index = 0; index < stored_count; ++index) {
                const auto path = "/sample/layers/" + std::to_string(index);
                const auto& layer = stored_layers[index];
                edits.emplace_back(path+"/delta", layer.delta); edits.emplace_back(path+"/beta", layer.beta);
                edits.emplace_back(path+"/deltaMag", layer.delta_magnetic); edits.emplace_back(path+"/betaMag", layer.beta_magnetic);
                if (retained_tensor[index]) prepared[index] = {tensors[index], anisotropic[index]};
                else {
                    int classification = 0;
                    status_check(remagx_dielectric_tensor(&layer, tensor, magnetic, prepared[index].values.data(), &classification));
                    prepared[index].anisotropic = classification != 0;
                }
            }
            std::vector<std::array<double,18>> scattering(project.array_size("/sample/elementProfiles"));
            for (size_t index = 0; index < scattering.size(); ++index) {
                const auto path = "/sample/elementProfiles/" + std::to_string(index);
                if (previous && previous->elements.tensors.size() == scattering.size()*18) {
                    std::copy_n(previous->elements.tensors.data()+index*18,18,scattering[index].data());
                } else if (automatic) {
                    if (project.contains(path+"/scatteringTensor")) for (size_t part = 0; part < 18; ++part)
                        scattering[index][part] = project.number(path+"/scatteringTensor/"+std::to_string(part));
                } else {
                    const double factors[] = {project.number(path+"/f1"),project.number(path+"/f2"),project.number(path+"/f1Mag"),project.number(path+"/f2Mag")};
                    status_check(remagx_scattering_tensor(factors,project.number("/calculation/magnetization/direction/gamma"),
                        project.number("/calculation/magnetization/direction/phi"),tensor,magnetic,scattering[index].data()));
                }
            }
            const auto emit = options->script_output ? options->script_output : [](const std::string&) {};
            std::unique_ptr<ProjectScriptHook> temporary;
            if (!persistent_hook) temporary = std::make_unique<ProjectScriptHook>(tables,emit,true,options->should_stop);
            auto result = (persistent_hook ? *persistent_hook : *temporary).run(project.with_calculation_numbers(edits), prepared, scattering, cursors,0,
                previous && !previous->resolved_tables.empty() ? &previous->resolved_tables : nullptr);
            project = std::move(result.project); cursors = std::move(result.cursors);
            script_elements.cursors = cursors;
            script_resolved_tables = std::move(result.resolved_tables);
            for (size_t index = 0; index < result.scattering.size(); ++index) {
                const auto path = "/sample/elementProfiles/" + std::to_string(index);
                script_elements.factors.push_back({project.number(path+"/f1"),project.number(path+"/f2"),
                    project.number(path+"/f1Mag"),project.number(path+"/f2Mag")});
                script_elements.tensors.insert(script_elements.tensors.end(),result.scattering[index].begin(),result.scattering[index].end());
            }
            energy = project.number("/experiment/energy"); width = project.number("/experiment/resolution/angularFwhm");
            for (size_t index = 0; index < stored_count; ++index) {
                const auto path = "/sample/layers/" + std::to_string(index);
                stored_layers[index] = {project.number(path+"/thickness"),project.number(path+"/roughness"),
                    project.number(path+"/delta"),project.number(path+"/beta"),project.number(path+"/deltaMag"),project.number(path+"/betaMag"),
                    project.number(path+"/magnetization/gamma"),project.number(path+"/magnetization/phi")};
                tensors[index] = result.tensors[index].values;
                anisotropic[index] = result.tensors[index].anisotropic; retained_tensor[index] = true;
            }
        }
#endif
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
            segment_project_layers(project, layers, matrix, scripted ? &script_depths : nullptr);
            count = layers.size();
        }
        if (previous) *previous = {std::move(stored_layers), std::move(tensors),
            std::move(retained_tensor), std::move(anisotropic), std::move(cursors), std::move(script_elements), std::move(script_depths), std::move(script_resolved_tables)};
    }
    if (scripted && dichroic && fast) {
        const double wave = 2 * 3.14159265358979323846 / (12398.326 / energy);
        for (double qz : result.qz) require(qz / (wave * 2) < 1, "Qz exceeds the fast dichroic scan boundary.");
    }
    // CalcDicEScan captures k0 before Lua; monochromatic CalcEScan uses the
    // post-hook energy. Generated optical stacks still use the updated project.
    if (scripted && energy_point && dichroic) energy = sample_energy;
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
    if (script_result) *script_result = project;
    return result;
}

static ProjectCurve calculate_qz(const ProjectDocument& project, bool dichroic, const std::vector<OpticalTable>& tables,
    const std::vector<double>* fit_coordinates = nullptr, OpticalState* previous = nullptr,
    const ProjectCalculationOptions* options = nullptr, ProjectScriptHook* persistent_hook = nullptr,
    ProjectDocument* script_result = nullptr) {
    const double width = project.number("/experiment/resolution/energyFwhm");
    if (dichroic || width <= 1e-6) return calculate_inner(project, dichroic, tables, fit_coordinates,
        project.number("/experiment/energy"), previous, fit_coordinates ? CalculationContext::fit_dataset : CalculationContext::terminal, options, script_result, persistent_hook);
    require(!project.boolean("/calculation/postProcessing/fourierTransform"),
        "Fourier transformation is excluded from this application. Remove the obsolete Fourier setting before calculating.");
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
    OpticalState local_state;
    auto& state = previous ? *previous : local_state;
    std::set<std::string> seen_warnings;
    auto current_project = project;
    const bool scripted = project.boolean("/scripts/enabled") &&
        project.string("/scripts/beforeCalculation").find_first_not_of(" \t\n\r\f\v") != std::string::npos;
    for (size_t sample = 0; sample < 19; ++sample) {
        const double current_energy = energy + offsets[sample] * width;
        require(std::isfinite(current_energy) && current_energy > 0,
            "Energy-resolution samples must be positive and finite.");
        const double current_wave = 2 * 3.14159265358979323846 / (12398.326 / current_energy);
        std::vector<double> coordinates;
        coordinates.reserve(angles.size());
        for (double angle : angles) coordinates.push_back(2 * current_wave * std::sin(angle));
        const auto sampled_project = scripted ? current_project.with_calculation_numbers({{"/experiment/energy",current_energy}}) : project;
        const auto current = calculate_inner(sampled_project, false, tables, &coordinates, current_energy, &state,
            fit_coordinates ? CalculationContext::fit_energy_sample : CalculationContext::terminal, options, scripted ? &current_project : nullptr, persistent_hook);
        require(current.plus.size() == result.plus.size(), "Energy broadening changed the sample array length.");
        for (size_t point = 0; point < result.plus.size(); ++point)
            result.plus[point] += weights[sample] * current.plus[point];
        if (fit_coordinates) { result.minus = current.minus; result.asymmetry = current.asymmetry; }
        for (const auto& warning : current.warnings)
            if (seen_warnings.insert(warning).second) result.warnings.push_back(warning);
    }
    finite_column(result.plus);
    if (script_result) *script_result = current_project;
    return result;
}

ProjectCurve calculate_terminal_qz(const ProjectDocument& project, bool dichroic, const std::vector<OpticalTable>& tables, const ProjectCalculationOptions& options) {
    return calculate_qz(project, dichroic, tables, nullptr, nullptr, &options);
}
ProjectCurve calculate_fit_dataset_qz(const PreparedFitDataset& dataset, const std::vector<OpticalTable>& tables) {
    require(!dataset.energy_scan, "Native fit energy-scan integration is not available yet.");
    require(!dataset.project.boolean("/calculation/postProcessing/fourierTransform"), "Fourier transformation is excluded from this application. Remove the obsolete Fourier setting before calculating.");
    return calculate_qz(dataset.project, dataset.dichroic, tables, &dataset.measurement.at("qz"));
}

static ProjectDocument write_optical_state(const ProjectDocument&, const OpticalState&, double);
static ProjectCurve calculate_dataset(const PreparedFitDataset& dataset, const std::vector<OpticalTable>& tables, OpticalState& state,
    const ProjectCalculationOptions* options = nullptr, ProjectScriptHook* hook = nullptr, ProjectDocument* script_result = nullptr) {
    if (!dataset.energy_scan) return calculate_qz(dataset.project, dataset.dichroic, tables, &dataset.measurement.at("qz"), &state, options, hook, script_result);
    auto project = dataset.project;
    const bool scripted = hook != nullptr;
    require(!project.boolean("/calculation/postProcessing/fourierTransform"), "Fourier transformation is excluded from this application. Remove the obsolete Fourier setting before calculating.");
    const auto& energies = dataset.measurement.at("energy");
    const auto& coordinates = dataset.measurement.at("qz");
    require(!energies.empty() && energies.size() == coordinates.size(), "Energy scan coordinates must be aligned and nonempty.");
    for (double energy : energies) require(std::isfinite(energy) && energy > 0, "Energy scan requires positive finite energies.");
    const double energy_width = project.number("/experiment/resolution/energyFwhm");
    require(std::isfinite(energy_width) && energy_width >= 0, "Energy resolution must be finite and nonnegative.");
    ProjectCurve result;
    result.qz = coordinates; result.energy = energies;
    std::vector<RemagxReflectivity> raw;
    raw.reserve(energies.size());
    std::set<std::string> seen_warnings;
    for (size_t index = 0; index < energies.size(); ++index) {
        const std::vector<double> point{coordinates[index]};
        if (scripted) project = project.with_calculation_numbers({{"/experiment/energy",energies[index]}});
        const auto current = calculate_inner(project, dataset.dichroic, tables, &point, energies[index], &state,
            CalculationContext::energy_point, options, scripted ? &project : nullptr, hook);
        if (scripted) project = write_optical_state(project,state,project.number("/experiment/energy"));
        raw.push_back({current.plus.at(0), current.minus.at(0)});
        for (const auto& warning : current.warnings)
            if (seen_warnings.insert(warning).second) result.warnings.push_back(warning);
    }
    std::vector<RemagxReflectivity> resolved(raw.size());
    status_check(remagx_energy_resolution(energies.data(), raw.data(), raw.size(), energy_width, resolved.data()));
    const double final_energy = scripted ? project.number("/experiment/energy") : energies.back();
    postprocess_curve(project, result, resolved, dataset.dichroic, CalculationContext::fit_dataset,
        beam(project, "/experiment/polarization/beam1"), beam(project, "/experiment/polarization/beam2"),
        final_energy, energies);
    if (script_result) *script_result = scripted ? project : project.with_calculation_numbers({{"/experiment/energy",final_energy}});
    return result;
}

ProjectCurve calculate_fit_dataset(const PreparedFitDataset& dataset, const std::vector<OpticalTable>& tables) {
    OpticalState state;
    return calculate_dataset(dataset, tables, state);
}
static ProjectDocument write_optical_state(const ProjectDocument& project, const OpticalState& state, double final_energy) {
        std::vector<std::pair<std::string, double>> edits{{"/experiment/energy", final_energy}};
        if (project.string("/sample/mode") == "element") {
            for (size_t element = 0; element < state.elements.factors.size(); ++element) {
                const std::string path = "/sample/elementProfiles/" + std::to_string(element) + "/";
                size_t field = 0;
                for (const auto* name : {"f1", "f2", "f1Mag", "f2Mag"})
                    edits.emplace_back(path + name, state.elements.factors[element][field++]);
            }
        } else {
            for (size_t layer = 0; layer < state.layers.size(); ++layer) {
                const auto path = "/sample/layers/" + std::to_string(layer) + "/";
                const auto& values = state.layers[layer];
                edits.emplace_back(path + "delta", values.delta); edits.emplace_back(path + "beta", values.beta);
                edits.emplace_back(path + "deltaMag", values.delta_magnetic); edits.emplace_back(path + "betaMag", values.beta_magnetic);
            }
        }
        return project.with_calculation_numbers(edits);
}
static ProjectDatasetEvaluation evaluate_datasets(const ProjectDocument& source, const std::vector<OpticalTable>& tables, OpticalState& state,
    const ProjectCalculationOptions* options = nullptr, ProjectScriptHook* hook = nullptr) {
    ProjectDatasetEvaluation result{0, source, {}, {}};
    for (size_t index = 0; index < source.array_size("/datasets"); ++index) {
        if (!source.boolean("/datasets/" + std::to_string(index) + "/active")) continue;
        const auto prepared = prepare_fit_dataset(result.project, index);
        auto calculated_project = prepared.project;
        auto curve = calculate_dataset(prepared, tables, state, options, hook, &calculated_project);
        const auto error = evaluate_fit_dataset(prepared, {curve.qz, curve.energy, curve.plus, curve.minus, curve.asymmetry});
        result.error += error.weighted;
        require(std::isfinite(result.error), "Weighted dataset total exceeds the finite double range.");
        double final_energy = calculated_project.number("/experiment/energy");
        if (!prepared.energy_scan && !prepared.dichroic && prepared.project.number("/experiment/resolution/energyFwhm") > 1e-6)
            final_energy = 12398.326 / (12398.326 / prepared.project.number("/experiment/energy"));
        result.project = write_optical_state(calculated_project, state, final_energy);
        result.indices.push_back(index); result.curves.push_back(std::move(curve));
    }
    return result;
}

ProjectDatasetEvaluation evaluate_project_datasets(const ProjectDocument& source, const std::vector<OpticalTable>& tables) {
    OpticalState state;
    return evaluate_datasets(source, tables, state);
}
#ifdef REMAGX_NATIVE_LUA
static ProjectDocument run_fit_hook(const ProjectDocument& project, OpticalState& optical,
    ProjectScriptHook& hook, double renew) {
    std::vector<ScriptDielectricTensor> tensors(optical.tensors.size());
    for (size_t index = 0; index < tensors.size(); ++index)
        tensors[index] = {optical.tensors[index], optical.anisotropic[index]};
    std::vector<std::array<double,18>> scattering(optical.elements.factors.size());
    for (size_t index = 0; index < scattering.size(); ++index)
        std::copy_n(optical.elements.tensors.data()+index*18,18,scattering[index].data());
    const auto& cursors = project.string("/sample/mode") == "element" ? optical.elements.cursors : optical.cursors;
    auto result = hook.run(project,tensors,scattering,cursors,renew,
        optical.resolved_tables.empty() ? nullptr : &optical.resolved_tables);
    optical.resolved_tables = std::move(result.resolved_tables);
    optical.cursors = result.cursors; optical.elements.cursors = std::move(result.cursors);
    for (size_t index = 0; index < tensors.size(); ++index) {
        optical.tensors[index] = result.tensors[index].values;
        optical.anisotropic[index] = result.tensors[index].anisotropic;
        optical.retained[index] = true;
        const auto path = "/sample/layers/"+std::to_string(index)+"/";
        auto& layer = optical.layers[index];
        layer.delta = result.project.number(path+"delta"); layer.beta = result.project.number(path+"beta");
        layer.delta_magnetic = result.project.number(path+"deltaMag"); layer.beta_magnetic = result.project.number(path+"betaMag");
    }
    for (size_t index = 0; index < scattering.size(); ++index) {
        const auto path = "/sample/elementProfiles/"+std::to_string(index)+"/";
        size_t field = 0;
        for (const auto* name : {"f1","f2","f1Mag","f2Mag"})
            optical.elements.factors[index][field++] = result.project.number(path+name);
        std::copy(result.scattering[index].begin(),result.scattering[index].end(),optical.elements.tensors.begin()+index*18);
    }
    return std::move(result.project);
}
#endif
struct ProjectFitObjective::State {
    explicit State(const ProjectDocument& source) : project(source) {}
    ProjectDocument project;
    std::vector<OpticalTable> tables;
    OpticalState optical;
    double weight;
    bool started = false;
    bool failed = false;
    bool prepared = false;
    ProjectCalculationOptions options;
#ifdef REMAGX_NATIVE_LUA
    std::unique_ptr<ProjectScriptHook> hook;
#endif
};
ProjectFitObjective::ProjectFitObjective(const ProjectDocument& project, std::vector<OpticalTable> tables,
    const ProjectCalculationOptions& options)
    : state_(std::make_unique<State>(project)) {
    state_->tables = std::move(tables);
    state_->weight = project.number("/fit/occamQ"); state_->options = options;
}
ProjectFitObjective::~ProjectFitObjective() = default;
ProjectDocument ProjectFitObjective::prepare_standalone() {
    require(!state_->started, "Fit preparation must precede candidate evaluation.");
    auto project = state_->project;
    OpticalState optical;
    const bool automatic = project.boolean("/calculation/automaticOpticalConstants");
    const int tensor = project.string("/calculation/tensorContribution") == "tetragonal" ? REMAGX_TETRAGONAL : REMAGX_ISOTROPIC;
    const int magnetic = project.string("/calculation/magnetization/mode") == "none" ? 0 : 1;
    const size_t count = project.array_size("/sample/layers");
    optical.tensors.resize(count); optical.retained.assign(count, true); optical.anisotropic.assign(count, false);
    optical.cursors.assign(state_->tables.size(), 0);
    for (size_t index = 0; index < count; ++index) {
        const auto path = "/sample/layers/" + std::to_string(index);
        RemagxLayer layer{project.number(path + "/thickness"), project.number(path + "/roughness"),
            project.number(path + "/delta"), project.number(path + "/beta"), project.number(path + "/deltaMag"),
            project.number(path + "/betaMag"), project.number(path + "/magnetization/gamma"), project.number(path + "/magnetization/phi")};
        optical.layers.push_back(layer);
        if (automatic) {
            if (project.contains(path + "/dielectricTensor")) {
                optical.anisotropic[index] = project.boolean(path + "/dielectricTensor/anisotropic");
                for (size_t part = 0; part < 18; ++part) optical.tensors[index][part] = project.number(path + "/dielectricTensor/values/" + std::to_string(part));
            }
        } else {
            int anisotropic = 0;
            status_check(remagx_dielectric_tensor(&layer, tensor, magnetic, optical.tensors[index].data(), &anisotropic));
            optical.anisotropic[index] = anisotropic != 0;
        }
    }
    const size_t elements = project.array_size("/sample/elementProfiles");
    optical.elements.tensors.resize(elements * 18, 0); optical.elements.cursors.assign(state_->tables.size(), 0);
    for (size_t index = 0; index < elements; ++index) {
        const auto path = "/sample/elementProfiles/" + std::to_string(index);
        optical.elements.factors.push_back({project.number(path + "/f1"), project.number(path + "/f2"),
            project.number(path + "/f1Mag"), project.number(path + "/f2Mag")});
        if (automatic) {
            if (project.contains(path + "/scatteringTensor"))
                for (size_t part = 0; part < 18; ++part) optical.elements.tensors[index * 18 + part] = project.number(path + "/scatteringTensor/" + std::to_string(part));
        } else status_check(remagx_scattering_tensor(optical.elements.factors[index].data(),
            project.number("/calculation/magnetization/direction/gamma"), project.number("/calculation/magnetization/direction/phi"),
            tensor, magnetic, optical.elements.tensors.data() + index * 18));
    }
    const auto refresh = [&](CalculationContext context) {
        const std::vector<double> coordinates;
        calculate_inner(project, false, state_->tables, &coordinates, project.number("/experiment/energy"), &optical, context);
        project = write_optical_state(project, optical, project.number("/experiment/energy"));
    };
    if (automatic) refresh(CalculationContext::refresh_only);
    bool active = false, energy_scan = false;
    for (size_t index = 0; index < project.array_size("/datasets"); ++index) {
        const auto path = "/datasets/" + std::to_string(index);
        if (!project.boolean(path + "/active")) continue;
        active = true;
        require(project.array_size(path + "/columns/qz") > 0, "An active fit dataset contains no data.");
        energy_scan = energy_scan || (project.contains(path + "/columns/energy") && project.array_size(path + "/columns/energy") > 0);
    }
    require(active, "Select at least one dataset for fitting.");
    if (automatic) refresh(CalculationContext::strict_refresh);
    if (energy_scan) refresh(CalculationContext::strict_refresh);
    state_->project = project; state_->optical = std::move(optical); state_->prepared = true;
    return project;
}
ProjectObjectiveResult ProjectFitObjective::evaluate(const std::vector<double>& values,
    const std::vector<double>& reference, bool refresh_reference) {
    require(!state_->failed, "Scripted fit session failed; create a new objective.");
    try {
        const auto& initial = state_->project;
        if (!state_->started && initial.boolean("/scripts/enabled") && initial.string("/scripts/beforeCalculation").find_first_not_of(" \t\n\r\f\v") != std::string::npos) {
#ifdef REMAGX_NATIVE_LUA
            require(state_->prepared, "Scripted fitting requires standalone preparation.");
            const auto emit = state_->options.script_output ? state_->options.script_output : [](const std::string&) {};
            state_->hook = std::make_unique<ProjectScriptHook>(state_->tables,emit,true,state_->options.should_stop);
            // CMultiFit constructs and executes the persistent script before candidates.
            auto& optical = state_->optical;
            const auto count = initial.array_size("/sample/layers");
            optical.layer_depths.assign(count,0);
            for (size_t index = 1; index < count; ++index)
                optical.layer_depths[index] = optical.layer_depths[index-1] + initial.number("/sample/layers/"+std::to_string(index)+"/thickness");
            state_->project = run_fit_hook(initial,optical,*state_->hook,0);
#else
            throw ProjectDocumentError("Native terminal was built without Lua support.");
#endif
        }
        auto candidate = apply_project_fit_parameters(state_->project, values);
        auto optical = state_->optical;
        // Candidate optical targets override the previous scalar snapshot. Tensor and
        // cursor history remain separate; automatic refresh may subsequently replace them.
        for (size_t layer = 0; layer < optical.layers.size(); ++layer) {
            const auto path = "/sample/layers/" + std::to_string(layer) + "/";
            optical.layers[layer].delta = candidate.project.number(path + "delta");
            optical.layers[layer].beta = candidate.project.number(path + "beta");
            optical.layers[layer].delta_magnetic = candidate.project.number(path + "deltaMag");
            optical.layers[layer].beta_magnetic = candidate.project.number(path + "betaMag");
        }
        for (size_t element = 0; element < optical.elements.factors.size(); ++element) {
            const auto path = "/sample/elementProfiles/" + std::to_string(element) + "/";
            size_t field = 0;
            for (const auto* name : {"f1", "f2", "f1Mag", "f2Mag"})
                optical.elements.factors[element][field++] = candidate.project.number(path + name);
        }
        if (candidate.project.boolean("/calculation/automaticOpticalConstants")) {
            const std::vector<double> coordinates;
            calculate_inner(candidate.project, false, state_->tables, &coordinates,
                candidate.project.number("/experiment/energy"), &optical, CalculationContext::refresh_only);
            candidate.project = write_optical_state(candidate.project, optical, candidate.project.number("/experiment/energy"));
        }
        ProjectScriptHook* hook = nullptr;
#ifdef REMAGX_NATIVE_LUA
        hook = state_->hook.get();
        if (hook) {
            // ImplementFitVariable rebuilds depths before the objective hook.
            optical.layer_depths.assign(candidate.project.array_size("/sample/layers"),0);
            for (size_t index = 1; index < optical.layer_depths.size(); ++index)
                optical.layer_depths[index] = optical.layer_depths[index-1] + candidate.project.number("/sample/layers/"+std::to_string(index)+"/thickness");
            candidate.project = run_fit_hook(candidate.project,optical,*hook,1);
        }
#endif
        auto evaluated = evaluate_datasets(candidate.project, state_->tables, optical, &state_->options, hook);
        auto actual_reference = refresh_reference ? candidate.values : reference;
        const double error = fit_regularization(evaluated.error, state_->weight, actual_reference, candidate.values);
        ProjectObjectiveResult result{evaluated.project, candidate.values, actual_reference, error};
        state_->project = evaluated.project; state_->optical = std::move(optical); state_->started = true;
        return result;
    } catch (...) {
#ifdef REMAGX_NATIVE_LUA
        if (state_->hook) state_->failed = true;
#endif
        throw;
    }
}
}
