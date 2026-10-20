#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
// Consume the original 1001-sample layout without choosing how its samples are
// generated. Legacy initialization uses denominator 999, including a guard point.
double errorFunction(double position, const double* samples) {
    if (position < -5.0) return -1.0;
    if (position > 5.0) return 1.0;
    const double coordinate = 0.0 - (-5.0 - position) / (-5.0 - 5.0) * (0.0 - 999.0);
    const int left = static_cast<int>(coordinate);
    return samples[left] - (left - coordinate) / (left - (left + 1.0)) * (samples[left] - samples[left + 1]);
}
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
