#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
bool valid(const RemagxGaussianProfile* profile) {
    return profile && std::isfinite(profile->center) && std::isfinite(profile->width) &&
        std::isfinite(profile->delta_amplitude) && std::isfinite(profile->beta_amplitude);
}
double evaluate(double amplitude, double position, const RemagxGaussianProfile& profile) {
    if (profile.width == 0.0) return 0.0;
    return amplitude * std::exp(-((position - profile.center) * (position - profile.center)) /
        2.0 / (profile.width * profile.width));
}
}

extern "C" int remagx_gaussian_profile(const RemagxGaussianProfile* profile,
                                       const double* positions, size_t count, double* output) {
    if (!valid(profile) || !positions || !count || !output) return REMAGX_INVALID_ARGUMENT;
    if (count > std::numeric_limits<size_t>::max() / (2 * sizeof(double))) return REMAGX_ALLOCATION_ERROR;
    for (size_t index = 0; index < count; ++index)
        if (!std::isfinite(positions[index])) return REMAGX_INVALID_ARGUMENT;
    try {
        std::vector<double> result(count * 2);
        for (size_t index = 0; index < count; ++index) {
            result[2 * index] = evaluate(profile->delta_amplitude, positions[index], *profile);
            result[2 * index + 1] = evaluate(profile->beta_amplitude, positions[index], *profile);
            if (!std::isfinite(result[2 * index]) || !std::isfinite(result[2 * index + 1]))
                return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(result.begin(), result.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}

extern "C" int remagx_gaussian_spline_knots(const RemagxGaussianProfile* profile, int intervals,
                                             double* positions, double* values) {
    if (!valid(profile) || !positions || !values || intervals < 0 ||
        intervals > std::numeric_limits<int>::max() - 5) return REMAGX_INVALID_ARGUMENT;
    const size_t count = static_cast<size_t>(intervals) + 5;
    try {
        std::vector<double> coordinates(count), ordinates(count);
        const double minimum = profile->center - 6.0 * profile->width;
        const double maximum = profile->center + 6.0 * profile->width;
        for (size_t index = 0; index < count; ++index) {
            // CGaussFunc::BuildSpline uses LinInterpolation, then divides the
            // evaluated delta amplitude back out. Keep that rounding order.
            coordinates[index] = minimum - (0.0 - static_cast<double>(index)) /
                (0.0 - (intervals + 4)) * (minimum - maximum);
            ordinates[index] = evaluate(profile->delta_amplitude, coordinates[index], *profile) /
                (profile->delta_amplitude == 0.0 ? 1.0 : profile->delta_amplitude);
            if (!std::isfinite(coordinates[index]) || !std::isfinite(ordinates[index]))
                return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(coordinates.begin(), coordinates.end(), positions);
        std::copy(ordinates.begin(), ordinates.end(), values);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}

extern "C" int remagx_apply_gaussian_profiles(const RemagxGaussianProfile* profiles, size_t profile_count,
                                               const double* positions, const double* initial_values,
                                               const double* weights, size_t sample_count, int coupled,
                                               double* output) {
    if (!positions || !initial_values || !output || !sample_count || (coupled != 0 && coupled != 1) ||
        (profile_count && (!profiles || !weights))) return REMAGX_INVALID_ARGUMENT;
    if (sample_count > std::numeric_limits<size_t>::max() / (2 * sizeof(double)) ||
        profile_count > std::numeric_limits<size_t>::max() / sizeof(RemagxGaussianProfile) ||
        (profile_count && sample_count > std::numeric_limits<size_t>::max() / sizeof(double) / profile_count))
        return REMAGX_ALLOCATION_ERROR;
    for (size_t profile = 0; profile < profile_count; ++profile)
        if (!valid(profiles + profile)) return REMAGX_INVALID_ARGUMENT;
    for (size_t sample = 0; sample < sample_count; ++sample) {
        if (!std::isfinite(positions[sample]) || !std::isfinite(initial_values[2 * sample]) ||
            !std::isfinite(initial_values[2 * sample + 1])) return REMAGX_INVALID_ARGUMENT;
        for (size_t profile = 0; profile < profile_count; ++profile)
            if (!std::isfinite(weights[sample * profile_count + profile])) return REMAGX_INVALID_ARGUMENT;
    }
    try {
        std::vector<double> result(initial_values, initial_values + sample_count * 2);
        for (size_t sample = 0; sample < sample_count; ++sample) {
            for (size_t profile = 0; profile < profile_count; ++profile) {
                const auto& shape = profiles[profile];
                if (shape.delta_amplitude == 0.0 && shape.beta_amplitude == 0.0) continue;
                const double weight = weights[sample * profile_count + profile];
                if (weight == 0.0) continue;
                const double delta = evaluate(shape.delta_amplitude, positions[sample], shape);
                const double beta = evaluate(shape.beta_amplitude, positions[sample], shape);
                if (coupled) {
                    // CalcMagProfile updates in profile order, using the current
                    // segment value for each contribution, not its initial value.
                    result[2 * sample] += weight * result[2 * sample] * delta;
                    result[2 * sample + 1] += weight * result[2 * sample + 1] * beta;
                } else {
                    result[2 * sample] += weight * delta;
                    result[2 * sample + 1] += weight * beta;
                }
            }
            if (!std::isfinite(result[2 * sample]) || !std::isfinite(result[2 * sample + 1]))
                return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(result.begin(), result.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
