#include "remagx/project_fit.hpp"
#include <algorithm>
#include <cmath>

namespace remagx {
namespace {
void require(bool condition, const char* message) {
    if (!condition) throw ProjectDocumentError(message);
}
double bounded(double value, double lower, double upper) {
    // Ordered comparisons preserve signed zero at equal bounds.
    if (value < lower) value = lower;
    if (value > upper) value = upper;
    return value;
}
double initial_step(double value, double upper) {
    double step = std::abs(.05 * value);
    if (step <= 1e-7) step = std::abs(.05 * upper);
    return step <= 1e-7 ? 1e-8 : step;
}
}
ProjectFitSpace::ProjectFitSpace(const ProjectDocument& project) {
    const size_t count = project.array_size("/fit/parameters");
    origins_.reserve(count); lower_.reserve(count); upper_.reserve(count);
    for (size_t index = 0; index < count; ++index) {
        const std::string path = "/fit/parameters/" + std::to_string(index);
        const double value = project.number(path + "/value");
        const double lower = project.number(path + "/lowerBound"), upper = project.number(path + "/upperBound");
        require(std::isfinite(value) && std::isfinite(lower) && std::isfinite(upper) && lower <= upper,
            "Invalid fit value or parameter bounds.");
        const double origin = bounded(value, lower, upper);
        origins_.push_back(origin); lower_.push_back(lower); upper_.push_back(upper);
        if (lower == upper) continue;
        const double step = initial_step(value, upper);
        double other = std::min(upper, origin + step);
        if (other == origin) other = std::max(lower, origin - step);
        // If addition loses the displacement, a distinct endpoint remains usable.
        // No decimal rounding or nextafter adjustment is introduced.
        if (other == origin) other = origin != upper ? upper : lower;
        const double scale = other - origin;
        require(std::isfinite(scale) && scale != 0, "Cannot initialize a fit axis within its bounds.");
        axes_.push_back({index, scale});
    }
}
std::vector<std::vector<double>> ProjectFitSpace::simplex() const {
    if (axes_.empty()) return {};
    std::vector<std::vector<double>> vertices(axes_.size() + 1, std::vector<double>(axes_.size(), 0));
    for (size_t index = 0; index < axes_.size(); ++index) vertices[index + 1][index] = 1;
    return vertices;
}
std::vector<double> ProjectFitSpace::decode(const std::vector<double>& coordinates) const {
    require(coordinates.size() == axes_.size(), "Normalized fit candidate dimension differs.");
    auto values = origins_;
    for (size_t index = 0; index < axes_.size(); ++index) {
        require(std::isfinite(coordinates[index]), "Normalized fit candidate must be finite.");
        const auto& axis = axes_[index];
        const double value = coordinates[index] == 0 ? origins_[axis.index]
            : origins_[axis.index] + coordinates[index] * axis.scale;
        require(std::isfinite(value), "Fit candidate exceeds the supported numerical range.");
        values[axis.index] = value;
    }
    return values;
}
std::vector<double> ProjectFitSpace::bound(const std::vector<double>& candidate) const {
    require(candidate.size() == origins_.size(), "Fit candidate and parameter counts differ.");
    std::vector<double> result;
    result.reserve(candidate.size());
    for (size_t index = 0; index < candidate.size(); ++index) {
        require(std::isfinite(candidate[index]), "Fit candidate must be finite.");
        result.push_back(bounded(candidate[index], lower_[index], upper_[index]));
    }
    return result;
}
double fit_regularization(double error, double weight, const std::vector<double>& reference,
                          const std::vector<double>& candidate) {
    require(std::isfinite(error) && std::isfinite(weight) && reference.size() == candidate.size(),
        "Invalid fit regularization inputs.");
    for (size_t index = 0; index < candidate.size(); ++index)
        require(std::isfinite(reference[index]) && std::isfinite(candidate[index]), "Fit regularization parameters must be finite.");
    if (weight == 0) return error;
    double total = error;
    for (size_t index = 0; index < candidate.size(); ++index) {
        // The threshold tests the candidate, not the reference. Preserve the
        // original multiplication/accumulation order instead of pre-summing Q.
        if (std::abs(candidate[index]) < 1e-6) continue;
        const double difference = reference[index] - candidate[index];
        total += weight * difference * difference;
        require(std::isfinite(total), "Fit regularization exceeds the supported numerical range.");
    }
    return total;
}
}
