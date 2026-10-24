#pragma once
#include "project_document.hpp"
#include <map>
#include <vector>
namespace remagx {
using DatasetColumns = std::map<std::string, std::vector<double>>;
struct PreparedFitDataset {
    ProjectDocument project;
    DatasetColumns measurement;
    int error_mode;
    bool energy_scan, dichroic;
    double weight;
};
PreparedFitDataset prepare_fit_dataset(const ProjectDocument& project, size_t index);
struct CalculatedFitDataset {
    std::vector<double> qz, energy, plus, minus, asymmetry;
};
struct FitDatasetError {
    double mean, weighted;
    size_t accepted;
};
// Calls the maintained C API on aligned, already calculated/postprocessed curves.
// It does not calculate reflectivity, carry optical state or add the Q penalty.
FitDatasetError evaluate_fit_dataset(const PreparedFitDataset& dataset, const CalculatedFitDataset& curve);
}
