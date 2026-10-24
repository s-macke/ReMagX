#pragma once
#include "project_document.hpp"
#include "project_calculation.hpp"
#include "optical_tables.hpp"
#include <memory>
#include <functional>
#include "optimizer.h"
#include <vector>
namespace remagx {
// Dimensionless initialization metadata for the maintained clean-room optimizer.
// Saved fit steps are deliberately ignored, matching the legacy constructor.
class ProjectFitSpace {
public:
    explicit ProjectFitSpace(const ProjectDocument& project);
    std::vector<std::vector<double>> simplex() const;
    std::vector<double> decode(const std::vector<double>& coordinates) const;
    std::vector<double> bound(const std::vector<double>& candidate) const;
    size_t dimensions() const { return axes_.size(); }
private:
    struct Axis { size_t index; double scale; };
    std::vector<double> origins_, lower_, upper_;
    std::vector<Axis> axes_;
};
struct ProjectFitCandidate {
    ProjectDocument project;
    std::vector<double> values;
};
// Uses the supplied current dataset context, which may differ from UI selection
// after serial objective evaluation. Input is unchanged even on failure.
ProjectFitCandidate apply_project_fit_parameters(const ProjectDocument& project, const std::vector<double>& candidate);

// Caller supplies the actual optimizer reference, which may change between
// ordinary Simplex rounds. Do not substitute the initially saved parameter list.
double fit_regularization(double error, double weight, const std::vector<double>& reference,
                          const std::vector<double>& candidate);

struct ProjectObjectiveResult {
    ProjectDocument project;
    std::vector<double> values, reference;
    double error;
};
// Persistent candidate state for the optimizer. Caller owns reference selection.
// Construction does not replace standalone strict optical/Lua preparation.
class ProjectFitObjective {
public:
    ProjectFitObjective(const ProjectDocument& project, std::vector<OpticalTable> tables,
        const ProjectCalculationOptions& options = {});
    ~ProjectFitObjective();
    // GetState and strict fit-start preparation; call before candidate evaluation.
    ProjectDocument prepare_standalone();
    // First evaluation starts the persistent script after optimizer initialization.
    // A failed scripted objective is closed to further evaluation.
    ProjectObjectiveResult evaluate(const std::vector<double>& candidate,
        const std::vector<double>& reference, bool refresh_reference = false);
private:
    struct State;
    std::unique_ptr<State> state_;
};

struct ProjectFitOptions {
    RemagxSimplexOptions simplex{10000, 5000, 1e-9, 1e-14};
    std::function<bool()> should_stop;
    std::function<void(const std::string&)> script_output;
};
struct ProjectFitResult {
    ProjectObjectiveResult best;
    size_t iterations, evaluations;
    int termination;
};
ProjectFitResult run_project_fit(const ProjectDocument& project, const std::vector<OpticalTable>& tables,
                                const ProjectFitOptions& options = {});
}
