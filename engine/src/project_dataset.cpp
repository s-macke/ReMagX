#include "remagx/project_dataset.hpp"
#include "remagx/fit_error.h"
#include <algorithm>
#include <cmath>

namespace remagx {
namespace {
void require(bool condition, const char* message) {
    if (!condition) throw ProjectDocumentError(message);
}
void finite_columns(const DatasetColumns& columns) {
    for (const auto& column : columns) for (double value : column.second)
        require(std::isfinite(value), "Dataset preparation exceeds the finite double range.");
}
bool pure_pi(const ProjectDocument& project, const std::string& beam) {
    const auto path = "/experiment/polarization/" + beam;
    return project.number(path + "/sigma/re") == 0 && project.number(path + "/sigma/im") == 0 &&
        project.number(path + "/pi/re") == 1 && project.number(path + "/pi/im") == 0;
}
}
PreparedFitDataset prepare_fit_dataset(const ProjectDocument& source, size_t index) {
    auto project = source.for_fit_dataset(index);
    const auto path = "/datasets/" + std::to_string(index);
    const size_t count = project.array_size(path + "/columns/qz");
    require(count > 0, "A fit dataset requires qz coordinates.");
    DatasetColumns columns;
    for (const auto* name : {"qz", "energy", "reflectivity", "reflectivityPlus", "reflectivityMinus", "asymmetry", "electronYield"}) {
        const auto column_path = path + "/columns/" + name;
        if (!project.contains(column_path)) continue;
        auto& values = columns[name];
        values.reserve(count);
        for (size_t point = 0; point < count; ++point) values.push_back(project.number(column_path + "/" + std::to_string(point)));
    }
    const bool energy_scan = columns.count("energy") != 0;
    const bool linear = project.string("/fit/errorFunction") == "lin-chi2";
    int mode;
    if (columns.count("reflectivity")) mode = energy_scan ? (linear ? 5 : 4) : (linear ? 1 : 0);
    else if (columns.count("asymmetry")) mode = energy_scan ? 6 : 2;
    else if (columns.count("reflectivityPlus") && columns.count("reflectivityMinus")) mode = energy_scan ? 7 : 3;
    else throw ProjectDocumentError("Dataset has no supported reflectivity, asymmetry or paired-beam fit data.");
    require(!project.boolean("/calculation/postProcessing/fourierTransform"),
        "Fourier transformation is excluded from this application. Remove the obsolete Fourier setting before calculating.");
    const double qz_shift = project.number(path + "/qzShift"), energy_shift = project.number(path + "/energyShift");
    if (std::abs(qz_shift) > 1e-10) for (auto& value : columns.at("qz")) value += qz_shift;
    if (energy_scan && std::abs(energy_shift) > 1e-10) for (auto& value : columns.at("energy")) value += energy_shift;
    const double offset = project.number(path + "/intensityOffset"), scale = project.number(path + "/intensityScale");
    for (const auto* name : {"reflectivity", "reflectivityPlus", "reflectivityMinus", "electronYield"})
        if (columns.count(name)) for (auto& value : columns.at(name)) value = (value + offset) * scale;
    finite_columns(columns);
    const bool multiply = project.boolean("/calculation/postProcessing/multiplyByQz4");
    const bool divide = project.boolean("/calculation/postProcessing/divideByCos2ThetaSquared");
    const bool correct_first = pure_pi(project, "beam1"), correct_second = pure_pi(project, "beam2");
    for (const auto* name : {"reflectivity", "reflectivityPlus", "reflectivityMinus"}) {
        if (!columns.count(name)) continue;
        auto& values = columns.at(name);
        const bool correction = std::string(name) == "reflectivityMinus" ? correct_second : correct_first;
        for (size_t point = 0; point < count; ++point) {
            const double qz = columns.at("qz")[point];
            if (multiply) values[point] *= qz * qz * qz * qz;
            if (divide && correction) {
                const double energy = energy_scan ? columns.at("energy")[point] : project.number("/experiment/energy");
                const double wave = 2 * 3.14159265358979323846 / (12398.326 / energy);
                const double ratio = qz / (2 * wave);
                const double angle = std::abs(ratio) >= 1 ? -1 : std::asin(ratio);
                values[point] /= std::cos(2 * angle) * std::cos(2 * angle);
            }
        }
    }
    if (columns.count("asymmetry") && columns.count("reflectivityPlus") && columns.count("reflectivityMinus")) {
        const bool difference = project.string("/calculation/asymmetryDefinition") == "difference";
        for (size_t point = 0; point < count; ++point) {
            const double plus = columns.at("reflectivityPlus")[point], minus = columns.at("reflectivityMinus")[point];
            columns.at("asymmetry")[point] = difference ? plus - minus : plus + minus != 0 ? (plus - minus) / (plus + minus) : 0;
        }
    }
    finite_columns(columns);
    const double width_value = project.number("/calculation/averaging");
    require(width_value >= 0 && width_value <= 2147483647.0 && std::floor(width_value) == width_value,
        "Invalid moving-average half-width.");
    const auto width = static_cast<size_t>(width_value);
    if (width) for (const auto* name : {"reflectivity", "reflectivityPlus", "reflectivityMinus", "asymmetry"}) {
        if (!columns.count(name)) continue;
        const auto values = columns.at(name);
        auto& result = columns.at(name);
        for (size_t point = 0; point < count; ++point) {
            if (point < width) { result[point] = 0; continue; }
            const size_t start = point - width, end = std::min(count - 1, point + width);
            double sum = 0;
            for (size_t neighbor = start; neighbor <= end; ++neighbor) sum += values[neighbor];
            result[point] = sum / static_cast<double>(end - start + 1);
        }
    }
    finite_columns(columns);
    const double weight = project.number(path + "/errorWeight");
    return {std::move(project), std::move(columns), mode, energy_scan, mode == 2 || mode == 3 || mode == 6 || mode == 7, weight};
}
FitDatasetError evaluate_fit_dataset(const PreparedFitDataset& dataset, const CalculatedFitDataset& curve) {
    const auto& columns = dataset.measurement;
    const auto& qz = columns.at("qz");
    require(curve.qz == qz, "Fit calculation and measurement coordinates differ.");
    if (dataset.energy_scan) require(curve.energy == columns.at("energy"), "Fit calculation and measurement energies differ.");
    const bool asymmetry = dataset.error_mode == 2 || dataset.error_mode == 6;
    const bool paired = dataset.error_mode == 3 || dataset.error_mode == 7;
    const auto& measured = columns.at(asymmetry ? "asymmetry" : paired ? "reflectivityPlus" : "reflectivity");
    const auto& calculated = asymmetry ? curve.asymmetry : curve.plus;
    require(calculated.size() == qz.size() && (!paired || curve.minus.size() == qz.size()), "Fit curve column length differs.");
    double error = 0;
    size_t accepted = 0;
    const auto& project = dataset.project;
    const int status = remagx_fit_dataset_error(dataset.error_mode, qz.data(), dataset.energy_scan ? columns.at("energy").data() : nullptr,
        measured.data(), calculated.data(), paired ? columns.at("reflectivityMinus").data() : nullptr,
        paired ? curve.minus.data() : nullptr, qz.size(), project.number("/fit/window/qzMin"), project.number("/fit/window/qzMax"),
        project.number("/fit/window/energyMin"), project.number("/fit/window/energyMax"), &error, &accepted, nullptr);
    require(status == REMAGX_SUCCESS, "Native fit dataset error calculation failed.");
    const double weighted = dataset.weight * error;
    require(std::isfinite(weighted), "Weighted dataset error exceeds the finite double range.");
    return {error, weighted, accepted};
}
}
