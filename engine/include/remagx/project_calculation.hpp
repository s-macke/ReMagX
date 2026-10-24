#ifndef REMAGX_PROJECT_CALCULATION_HPP
#define REMAGX_PROJECT_CALCULATION_HPP
#include "project_document.hpp"
#include "project_dataset.hpp"
#include "optical_tables.hpp"
#include <vector>
#include <functional>
namespace remagx {
struct ProjectCalculationOptions {
    std::function<void(const std::string&)> script_output;
    std::function<bool()> should_stop;
};
struct ProjectCurve {
    std::vector<double> qz;
    std::vector<double> plus;
    std::vector<double> minus;
    std::vector<std::string> warnings;
    std::vector<double> asymmetry;
    std::vector<double> energy;
};
// Native terminal coordinates (0..qzMax inclusive), distinct from the web grid.
// Current integration: manual/automatic compound constants, Nevot-Croce/adaptive
// roughness, three solvers,
// multilayer expansion, angular/monochromatic energy convolution and postprocessing
// (monochromatic Fourier only). Other preparation rejects explicitly.
// No input mutation and no partial curve on failure.
ProjectCurve calculate_terminal_qz(const ProjectDocument& project, bool dichroic,
                                   const std::vector<OpticalTable>& tables = {},
                                   const ProjectCalculationOptions& options = {});
// Calculate one prepared qz dataset, including monochromatic energy broadening.
// Rejects energy datasets; use calculate_fit_dataset for either scan type.
ProjectCurve calculate_fit_dataset_qz(const PreparedFitDataset& dataset,
                                     const std::vector<OpticalTable>& tables = {});
// One prepared qz or energy dataset with fresh optical state.
ProjectCurve calculate_fit_dataset(const PreparedFitDataset& dataset,
                                  const std::vector<OpticalTable>& tables = {});
struct ProjectDatasetEvaluation {
    double error;
    ProjectDocument project;
    std::vector<size_t> indices;
    std::vector<ProjectCurve> curves;
};
// Serial weighted means for active datasets. Does not add Q or run an optimizer.
// A failure leaves the source project unchanged and publishes no partial result.
ProjectDatasetEvaluation evaluate_project_datasets(const ProjectDocument& project,
                                                   const std::vector<OpticalTable>& tables = {});
}
#endif
