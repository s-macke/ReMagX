#include "remagx/project_calculation.hpp"
#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <string>

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
}

ProjectCurve calculate_terminal_qz(const ProjectDocument& project, bool dichroic) {
    const auto algorithm = project.string("/calculation/algorithm");
    require(algorithm == "parratt" || algorithm == "matrix" || algorithm == "zak", "This solver is unavailable in the native terminal.");
    require(project.string("/sample/mode") == "compound", "Native terminal element preparation is not integrated yet.");
    require(project.string("/experiment/scattering") == "reflection", "Transmission is unavailable in this calculation path.");
    require(!project.boolean("/calculation/automaticOpticalConstants"), "Native terminal optical-table refresh is not integrated yet; use manual constants.");
    if (project.boolean("/scripts/enabled")) {
        const auto script = project.string("/scripts/beforeCalculation");
        require(script.find_first_not_of(" \t\n\r\f\v") == std::string::npos, "Native terminal BeforeCalculation Lua execution is not integrated yet.");
    }
    require(!project.boolean("/sample/multilayer/enabled"), "Native terminal multilayer expansion is not integrated yet.");
    require(project.string("/calculation/roughnessModel") == "nevot-croce", "Native terminal adaptive segmentation is not integrated yet.");
    require(!project.boolean("/calculation/postProcessing/divideByCos2ThetaSquared"), "Native terminal polarization postprocessing is not integrated yet.");
    require(!project.boolean("/calculation/postProcessing/fourierTransform"), "Native terminal Fourier postprocessing is not integrated yet.");
    require(dichroic || project.number("/experiment/resolution/energyFwhm") <= 1e-6, "Native terminal qz energy convolution is not integrated yet.");
    const double average_width = project.number("/calculation/averaging");
    require(average_width <= 2147483647.0, "Moving-average half-width exceeds the supported range.");

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
    const double energy = project.number("/experiment/energy");
    const bool fast = project.boolean("/experiment/resolution/fastConvolution");
    if (dichroic && fast) {
        const double wave = 2 * 3.14159265358979323846 / (12398.326 / energy);
        for (double qz : result.qz) require(qz / (wave * 2) < 1, "Qz exceeds the fast dichroic scan boundary.");
    }
    std::vector<RemagxLayer> layers;
    const size_t count = project.array_size("/sample/layers");
    require(count <= 100000, "Native terminal layer count exceeds the supported limit.");
    layers.reserve(count);
    for (size_t index = 0; index < count; ++index) {
        const auto path = "/sample/layers/" + std::to_string(index);
        layers.push_back({project.number(path + "/thickness"), project.number(path + "/roughness"),
            project.number(path + "/delta"), project.number(path + "/beta"),
            project.number(path + "/deltaMag"), project.number(path + "/betaMag"),
            project.number(path + "/magnetization/gamma"), project.number(path + "/magnetization/phi")});
    }
    const auto first = beam(project, "/experiment/polarization/beam1");
    const auto second = beam(project, "/experiment/polarization/beam2");
    const auto* second_pointer = dichroic ? &second : nullptr;
    const auto analyzer_name = project.string("/experiment/polarization/analyzer");
    const int analyzer = analyzer_name == "none" ? REMAGX_BOTH : analyzer_name == "sigma" ? REMAGX_SIGMA : REMAGX_PI;
    const int tensor = project.string("/calculation/tensorContribution") == "tetragonal" ? REMAGX_TETRAGONAL : REMAGX_ISOTROPIC;
    const int magnetic = project.string("/calculation/magnetization/mode") == "none" ? 0 : 1;
    const int mode = dichroic ? REMAGX_DICHROIC : REMAGX_MONOCHROMATIC;
    const double width = project.number("/experiment/resolution/angularFwhm");
    std::vector<RemagxReflectivity> values(result.qz.size());
    if (algorithm == "parratt") {
        status_check(remagx_parratt_qz_resolution(layers.data(), count, result.qz.data(), result.qz.size(), energy,
            &first, second_pointer, tensor, analyzer, magnetic, mode, width, fast, values.data()));
    } else if (algorithm == "zak") {
        status_check(remagx_zak_qz_resolution(layers.data(), count, result.qz.data(), result.qz.size(), energy,
            magnetic, &first, second_pointer, analyzer, mode, width, fast, values.data()));
    } else {
        std::vector<RemagxMatrixLayer> matrix;
        matrix.reserve(count);
        for (const auto& layer : layers) {
            RemagxMatrixLayer prepared{};
            prepared.thickness = layer.thickness; prepared.roughness = layer.roughness;
            prepared.index_real = 1 - layer.delta; prepared.index_imaginary = layer.beta;
            // Manual preparation rebuilds tensors, ignoring stored automatic overrides.
            status_check(remagx_dielectric_tensor(&layer, tensor, magnetic, prepared.dielectric, &prepared.anisotropic));
            matrix.push_back(prepared);
        }
        status_check(remagx_visnovsky_qz_resolution(matrix.data(), count, result.qz.data(), result.qz.size(), energy,
            project.number("/calculation/epsilon"), &first, second_pointer, analyzer, mode, width, fast, values.data()));
    }
    result.plus.reserve(values.size()); result.minus.reserve(values.size());
    const bool multiply = project.boolean("/calculation/postProcessing/multiplyByQz4");
    for (size_t index = 0; index < values.size(); ++index) {
        const double qz = result.qz[index];
        const double factor = multiply ? qz * qz * qz * qz : 1;
        result.plus.push_back(values[index].beam1 * factor);
        result.minus.push_back(values[index].beam2 * factor);
    }
    finite_column(result.plus); finite_column(result.minus);
    average(result.plus, static_cast<size_t>(average_width));
    average(result.minus, static_cast<size_t>(average_width));
    finite_column(result.plus); finite_column(result.minus);
    return result;
}
}
