#pragma once
#include "project_document.hpp"
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
// Caller supplies the actual optimizer reference, which may change between
// ordinary Simplex rounds. Do not substitute the initially saved parameter list.
double fit_regularization(double error, double weight, const std::vector<double>& reference,
                          const std::vector<double>& candidate);
}
