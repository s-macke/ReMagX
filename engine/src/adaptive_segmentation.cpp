#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <new>
#include <stdexcept>
#include <vector>

// LayerSegmentation2 subdivision and final resampling. The caller supplies the
// chosen legacy optical sampler; this component does not choose an erf policy.
extern "C" int remagx_adaptive_segments(double minimum_depth, double maximum_depth,
    double minimum_step, double maximum_step, double gradient_scale, size_t value_count,
    RemagxOpticalSampler sampler, void* context, size_t capacity,
    double* positions, double* thicknesses, double* values, size_t* count) {
    if (!std::isfinite(minimum_depth) || !std::isfinite(maximum_depth) || minimum_depth > maximum_depth ||
        !std::isfinite(minimum_step) || !std::isfinite(maximum_step) || minimum_step <= 0.0 || maximum_step < minimum_step ||
        !std::isfinite(gradient_scale) || (value_count != 4 && value_count != 22) || !sampler ||
        !capacity || capacity > 1000000 || !positions || !thicknesses || !values || !count) return REMAGX_INVALID_ARGUMENT;
    try {
        std::vector<double> depths, optics;
        auto sample = [&](double depth, size_t slot, double* output) {
            if (!std::isfinite(depth)) return false;
            // Missing callback components must not inherit a previous sample.
            std::fill(output, output + value_count, std::nan(""));
            if (sampler(depth, slot, output, context) != REMAGX_SUCCESS) return false;
            for (size_t component = 0; component < value_count; ++component)
                if (!std::isfinite(output[component])) return false;
            return true;
        };
        auto step = [&](const double* left, const double* right) {
            double gradient = std::abs((right[0] - left[0]) / 1e-4);
            for (size_t component = 1; component < 4; ++component) {
                const double current = std::abs((right[component] - left[component]) / 1e-4);
                if (current > gradient) gradient = current;
            }
            if (gradient == 0.0) gradient = 1e-50;
            const double denominator = gradient * gradient_scale * 1e5;
            double width = denominator == 0.0 ? minimum_step : 1.0 / denominator;
            if (width > maximum_step) width = maximum_step;
            if (width < minimum_step) width = minimum_step;
            return width;
        };
        double first[22], second[22], middle[22], shifted[22];
        for (double depth = minimum_depth; depth <= maximum_depth;) {
            if (depths.size() == capacity) return REMAGX_INVALID_ARGUMENT;
            if (!sample(depth, 0, first) || !sample(depth + 1e-4, 1, second)) return REMAGX_NUMERICAL_ERROR;
            const double provisional = step(first, second);
            if (!sample(depth + provisional / 2.0, 2, middle) ||
                !sample(depth + 1e-4 + provisional / 2.0, 3, shifted)) return REMAGX_NUMERICAL_ERROR;
            const double width = step(middle, shifted);
            const double center = depth + width / 2.0;
            const double next = depth + width;
            if (!std::isfinite(center) || !std::isfinite(next) || next <= depth) return REMAGX_NUMERICAL_ERROR;
            depths.push_back(center);
            // Original keeps the provisional midpoint values, although the stored
            // center follows the second width. Later entries are resampled below.
            optics.insert(optics.end(), middle, middle + value_count);
            depth = next;
        }
        for (size_t index = 1; index < depths.size(); ++index) {
            const double midpoint = (depths[index] + depths[index - 1]) * 0.5;
            if (!sample(midpoint, 0, optics.data() + index * value_count)) return REMAGX_NUMERICAL_ERROR;
        }
        std::vector<double> widths(depths.size(), 0.0);
        for (size_t index = 1; index < depths.size(); ++index) {
            widths[index] = depths[index] - depths[index - 1];
            if (!std::isfinite(widths[index])) return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(depths.begin(), depths.end(), positions);
        std::copy(widths.begin(), widths.end(), thicknesses);
        std::copy(optics.begin(), optics.end(), values);
        *count = depths.size();
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
