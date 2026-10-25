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
int splineValue(const double* knots, const double* values, size_t knot_count, double position, double& shape) {
    shape = 0.0;
    if (knot_count >= 4 && position >= knots[1] && position <= knots[knot_count - 2]) {
        // TSplineFunc selects the first knot >= position, without sorting.
        size_t right = 1;
        while (right < knot_count && position > knots[right]) ++right;
        // D-46: use the stored ordinate where the original reads values[-1].
        if (position == knots[1]) {
            shape = values[1];
            return REMAGX_SUCCESS;
        }
        if (right < 2 || right + 1 >= knot_count) return REMAGX_INVALID_ARGUMENT;
        const double fraction = 0.0 - (knots[right - 1] - position) /
            (knots[right - 1] - knots[right]) * (0.0 - 1.0);
        const double first = values[right - 2], second = values[right - 1];
        const double third = values[right], fourth = values[right + 1];
        // Preserve the original coefficient and Horner evaluation order.
        const double cubic = -0.5 * first + 1.5 * second + -1.5 * third + 0.5 * fourth;
        const double quadratic = first + -2.5 * second + 2.0 * third + -0.5 * fourth;
        const double linear = -0.5 * first + 0.0 * second + 0.5 * third + 0.0 * fourth;
        const double constant = 0.0 * first + second + 0.0 * third + 0.0 * fourth;
        shape = ((cubic * fraction + quadratic) * fraction + linear) * fraction + constant;
    }
    return std::isfinite(shape) ? REMAGX_SUCCESS : REMAGX_NUMERICAL_ERROR;
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

static int applyProfiles(const RemagxGaussianProfile* profiles, size_t profile_count,
                                               const int* spline_counts, const double* knots, const double* values, size_t knot_count,
                                               const double* positions, const double* initial_values,
                                               const double* weights, size_t sample_count, int coupled,
                                               double* output) {
    if (!positions || !initial_values || !output || !sample_count || (coupled != 0 && coupled != 1) ||
        (profile_count && (!profiles || !weights))) return REMAGX_INVALID_ARGUMENT;
    if (sample_count > std::numeric_limits<size_t>::max() / (2 * sizeof(double)) ||
        profile_count > std::numeric_limits<size_t>::max() / sizeof(RemagxGaussianProfile) ||
        (profile_count && sample_count > std::numeric_limits<size_t>::max() / sizeof(double) / profile_count))
        return REMAGX_ALLOCATION_ERROR;
    if (knot_count > std::numeric_limits<size_t>::max() / sizeof(double)) return REMAGX_ALLOCATION_ERROR;
    if (knot_count && (!spline_counts || !knots || !values)) return REMAGX_INVALID_ARGUMENT;
    size_t used_knots = 0;
    for (size_t profile = 0; profile < profile_count; ++profile) {
        if (!valid(profiles + profile)) return REMAGX_INVALID_ARGUMENT;
        if (spline_counts) {
            if (spline_counts[profile] < -1) return REMAGX_INVALID_ARGUMENT;
            if (spline_counts[profile] >= 0) {
                const size_t count = static_cast<size_t>(spline_counts[profile]);
                if (count > knot_count - used_knots) return REMAGX_INVALID_ARGUMENT;
                used_knots += count;
            }
        }
    }
    if (used_knots != knot_count) return REMAGX_INVALID_ARGUMENT;
    for (size_t knot = 0; knot < knot_count; ++knot)
        if (!std::isfinite(knots[knot]) || !std::isfinite(values[knot])) return REMAGX_INVALID_ARGUMENT;
    for (size_t sample = 0; sample < sample_count; ++sample) {
        if (!std::isfinite(positions[sample]) || !std::isfinite(initial_values[2 * sample]) ||
            !std::isfinite(initial_values[2 * sample + 1])) return REMAGX_INVALID_ARGUMENT;
        for (size_t profile = 0; profile < profile_count; ++profile)
            if (!std::isfinite(weights[sample * profile_count + profile])) return REMAGX_INVALID_ARGUMENT;
    }
    try {
        std::vector<double> result(initial_values, initial_values + sample_count * 2);
        for (size_t sample = 0; sample < sample_count; ++sample) {
            size_t knot_offset = 0;
            for (size_t profile = 0; profile < profile_count; ++profile) {
                const auto& shape = profiles[profile];
                const int count = spline_counts ? spline_counts[profile] : -1;
                const size_t offset = knot_offset;
                if (count > 0) knot_offset += static_cast<size_t>(count);
                if (shape.delta_amplitude == 0.0 && shape.beta_amplitude == 0.0) continue;
                const double weight = weights[sample * profile_count + profile];
                if (weight == 0.0) continue;
                double delta, beta;
                if (count >= 0) {
                    double value;
                    const int status = splineValue(count ? knots + offset : nullptr, count ? values + offset : nullptr,
                        static_cast<size_t>(count), positions[sample], value);
                    if (status != REMAGX_SUCCESS) return status;
                    delta = shape.delta_amplitude * value;
                    beta = shape.beta_amplitude * value;
                } else {
                    delta = evaluate(shape.delta_amplitude, positions[sample], shape);
                    beta = evaluate(shape.beta_amplitude, positions[sample], shape);
                }
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


extern "C" int remagx_apply_gaussian_profiles(const RemagxGaussianProfile* profiles, size_t profile_count,
    const double* positions, const double* initial_values, const double* weights, size_t sample_count, int coupled, double* output) {
    return applyProfiles(profiles, profile_count, nullptr, nullptr, nullptr, 0,
        positions, initial_values, weights, sample_count, coupled, output);
}

extern "C" int remagx_apply_magnetic_profiles(const RemagxGaussianProfile* profiles, size_t profile_count,
    const int* spline_counts, const double* knots, const double* values, size_t knot_count,
    const double* positions, const double* initial_values, const double* weights, size_t sample_count, int coupled, double* output) {
    if (profile_count && !spline_counts) return REMAGX_INVALID_ARGUMENT;
    return applyProfiles(profiles, profile_count, spline_counts, knots, values, knot_count,
        positions, initial_values, weights, sample_count, coupled, output);
}

extern "C" int remagx_gauss_lorentzian_imag(double energy, double center, double area,
                                            double width, double mixing_percent, double* output) {
    if (!output || !std::isfinite(energy) || !std::isfinite(center) || !std::isfinite(area) ||
        !std::isfinite(width) || !std::isfinite(mixing_percent)) return REMAGX_INVALID_ARGUMENT;
    if (width < 1e-5) width = 1e-5;
    const double offset = (energy - center) * (energy - center) / (width * width);
    const double lorentzian = area / width / (1.0 + (mixing_percent / 100.0) * 4.0 * offset);
    const double gaussian = std::exp(-4.0 * std::log(2.0) * (1.0 - mixing_percent / 100.0) * offset);
    const double result = gaussian * lorentzian;
    if (!std::isfinite(result)) return REMAGX_NUMERICAL_ERROR;
    *output = result;
    return REMAGX_SUCCESS;
}

extern "C" int remagx_gauss_lorentzian_real(double energy, double center, double area,
                                            double width, double mixing_percent, double* output) {
    if (!output || !std::isfinite(energy) || !std::isfinite(center) || !std::isfinite(area) ||
        !std::isfinite(width) || !std::isfinite(mixing_percent)) return REMAGX_INVALID_ARGUMENT;
    const double minimum = center - width * 2.0;
    const double maximum = center + width * 2.0;
    const double shifted_energy = energy + 0.001234;
    if (!std::isfinite(minimum) || !std::isfinite(maximum)) return REMAGX_NUMERICAL_ERROR;
    double result = 0.0;
    for (double position = minimum; position < maximum; position += 0.05) {
        const double next = position + 0.05;
        if (next <= position) return REMAGX_NUMERICAL_ERROR;
        double left, right;
        if (remagx_gauss_lorentzian_imag(position, center, area, width, mixing_percent, &left) ||
            remagx_gauss_lorentzian_imag(next, center, area, width, mixing_percent, &right))
            return REMAGX_NUMERICAL_ERROR;
        const double step = next - position;
        const double slope = (right - left) / step;
        const double distance = shifted_energy - position;
        const double ratio = -step / distance;
        const double difference_log = std::abs(ratio) < 0.5 ? std::log1p(ratio) :
            std::log(std::abs((shifted_energy - next) / distance));
        const double sum_log = std::log1p(step / (shifted_energy + position));
        // LocalKK's same analytic integral, with logarithms collected before
        // evaluation to avoid cancellation of large intercept terms. Retain
        // the original energy offset, double slope, and repeated-addition grid.
        const double integral = 0.5 * (left + slope * distance) * difference_log +
            0.5 * (left - slope * (shifted_energy + position)) * sum_log + slope * step;
        result += -2.0 / 3.14159265358979323846 * integral;
        if (!std::isfinite(result)) return REMAGX_NUMERICAL_ERROR;
    }
    *output = result;
    return REMAGX_SUCCESS;
}


extern "C" int remagx_spline_profile(const RemagxGaussianProfile* profile,
                                      const double* knots, const double* values, size_t knot_count,
                                      const double* positions, size_t count, double* output) {
    if (!valid(profile) || !positions || !count || !output || (knot_count && (!knots || !values)))
        return REMAGX_INVALID_ARGUMENT;
    if (count > std::numeric_limits<size_t>::max() / (2 * sizeof(double)) ||
        knot_count > std::numeric_limits<size_t>::max() / sizeof(double)) return REMAGX_ALLOCATION_ERROR;
    for (size_t index = 0; index < knot_count; ++index)
        if (!std::isfinite(knots[index]) || !std::isfinite(values[index])) return REMAGX_INVALID_ARGUMENT;
    for (size_t index = 0; index < count; ++index)
        if (!std::isfinite(positions[index])) return REMAGX_INVALID_ARGUMENT;
    try {
        std::vector<double> result(count * 2);
        for (size_t sample = 0; sample < count; ++sample) {
            double shape;
            const int status = splineValue(knots, values, knot_count, positions[sample], shape);
            if (status != REMAGX_SUCCESS) return status;
            result[2 * sample] = profile->delta_amplitude * shape;
            result[2 * sample + 1] = profile->beta_amplitude * shape;
            if (!std::isfinite(result[2 * sample]) || !std::isfinite(result[2 * sample + 1]))
                return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(result.begin(), result.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
