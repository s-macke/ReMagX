#include "remagx/core.h"
#include "error_function_lookup.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>


extern "C" double remagx_standard_erf(double);

// D-41: pinned standard erf in double precision, without legacy float quantization.
// Retain the 999-interval grid and the additional interpolation guard sample.
extern "C" int remagx_error_function_lookup(double* output, size_t count) {
    if (!output || count != 1001) return REMAGX_INVALID_ARGUMENT;
    std::array<double, 1001> samples;
    for (size_t index = 0; index < samples.size(); ++index) {
        const double position = -5.0 + static_cast<double>(index) * 10.0 / 999.0;
        samples[index] = remagx_standard_erf(position);
        if (!std::isfinite(samples[index])) return REMAGX_NUMERICAL_ERROR;
    }
    std::copy(samples.begin(), samples.end(), output);
    return 0;
}

extern "C" int remagx_layer_density(const double* boundaries, const double* roughness,
    size_t layer_count, size_t layer_index, const double* positions, size_t count,
    const double* error_samples, size_t error_sample_count, double* output) {
    if (!boundaries || !roughness || !layer_count || layer_index >= layer_count || !positions || !count ||
        !error_samples || error_sample_count != 1001 || !output) return REMAGX_INVALID_ARGUMENT;
    if (layer_count > std::numeric_limits<size_t>::max() / sizeof(double) ||
        count > std::numeric_limits<size_t>::max() / sizeof(double)) return REMAGX_ALLOCATION_ERROR;
    for (size_t layer = 0; layer < layer_count; ++layer)
        if (!std::isfinite(boundaries[layer]) || !std::isfinite(roughness[layer])) return REMAGX_INVALID_ARGUMENT;
    for (size_t sample = 0; sample < count; ++sample)
        if (!std::isfinite(positions[sample])) return REMAGX_INVALID_ARGUMENT;
    for (size_t sample = 0; sample < error_sample_count; ++sample)
        if (!std::isfinite(error_samples[sample])) return REMAGX_INVALID_ARGUMENT;
    try {
        std::vector<double> result(count);
        const double factor = 1.0 / std::sqrt(2.0);
        for (size_t sample = 0; sample < count; ++sample) {
            const double position = positions[sample];
            double upper, lower;
            if (layer_index == 0) {
                const double width = roughness[0] == 0.0 ? 1e-10 : roughness[0];
                upper = (position - boundaries[0]) / width * factor;
                lower = (position + 1e10) * factor;
            } else {
                const double lower_width = roughness[layer_index - 1] == 0.0 ? 1e-10 : roughness[layer_index - 1];
                const double upper_width = roughness[layer_index] == 0.0 ? 1e-10 : roughness[layer_index];
                upper = layer_index == layer_count - 1 ? (position - 1e10) * factor
                    : (position - boundaries[layer_index]) / upper_width * factor;
                lower = (position - boundaries[layer_index - 1]) / lower_width * factor;
            }
            result[sample] = 0.25 * ((1.0 - errorFunction(upper, error_samples)) *
                                     (1.0 + errorFunction(lower, error_samples)));
            if (!std::isfinite(result[sample])) return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(result.begin(), result.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}

// ElementLayerSystem::GetDensity uses normalized overlapping slab weights and
// different zero/outer roughness constants from compound-layer profile binding.
extern "C" int remagx_element_density(const double* slabs, size_t slab_count,
    const double* positions, size_t count, const double* error_samples,
    size_t error_sample_count, double* output) {
    if (!slabs || !slab_count || !positions || !count || !error_samples ||
        error_sample_count != 1001 || !output) return REMAGX_INVALID_ARGUMENT;
    if (slab_count > std::numeric_limits<size_t>::max() / (3 * sizeof(double)) ||
        count > std::numeric_limits<size_t>::max() / sizeof(double)) return REMAGX_ALLOCATION_ERROR;
    for (size_t slab = 0; slab < slab_count; ++slab) {
        const double* row = slabs + 3 * slab;
        if (!std::isfinite(row[0]) || !std::isfinite(row[1]) || !std::isfinite(row[2]) ||
            row[0] < 0.0 || row[1] < 0.0) return REMAGX_INVALID_ARGUMENT;
    }
    for (size_t point = 0; point < count; ++point)
        if (!std::isfinite(positions[point])) return REMAGX_INVALID_ARGUMENT;
    for (size_t sample = 0; sample < error_sample_count; ++sample)
        if (!std::isfinite(error_samples[sample])) return REMAGX_INVALID_ARGUMENT;
    try {
        std::vector<double> result(count);
        const double factor = 1.0 / std::sqrt(2.0);
        for (size_t point = 0; point < count; ++point) {
            double boundary = 0.0, weighted_density = 0.0, total_weight = 0.0;
            for (size_t slab = 0; slab < slab_count; ++slab) {
                const double* row = slabs + 3 * slab;
                double lower, upper, lower_width, upper_width;
                if (slab == 0) {
                    lower = -1e10; upper = boundary;
                    lower_width = 1e-5; upper_width = row[1];
                } else if (slab == slab_count - 1) {
                    lower = boundary; upper = 1e10;
                    lower_width = slabs[3 * (slab - 1) + 1]; upper_width = 1e-5;
                } else {
                    lower = boundary; upper = boundary + row[0];
                    lower_width = slabs[3 * (slab - 1) + 1]; upper_width = row[1];
                }
                if (!std::isfinite(upper)) return REMAGX_NUMERICAL_ERROR;
                if (lower_width == 0.0) lower_width = 1e-6;
                if (upper_width == 0.0) upper_width = 1e-6;
                const double upper_value = errorFunction((positions[point] - upper) / upper_width * factor, error_samples);
                const double lower_value = errorFunction((positions[point] - lower) / lower_width * factor, error_samples);
                const double weight = 0.25 * ((1.0 - upper_value) * (1.0 + lower_value));
                weighted_density += weight * row[2];
                total_weight += weight;
                if (slab > 0 && slab < slab_count - 1) boundary += row[0];
            }
            result[point] = weighted_density / total_weight;
            if (!std::isfinite(result[point])) return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(result.begin(), result.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
