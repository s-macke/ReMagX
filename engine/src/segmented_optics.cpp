#include "remagx/core.h"
#include "error_function_lookup.h"
#include <algorithm>
#include <cmath>
#include <limits>

extern "C" int remagx_segmented_optics(const RemagxLayer* layers, size_t layer_count,
    const double* boundaries, const double* tensors, int model, double position,
    const double* error_samples, size_t error_sample_count, double* output, double* tensor_state) {
    if (!layers || layer_count < 2 || model < 0 || model > 2 || (model == 0 && !boundaries) ||
        (tensor_state && !tensors) || !std::isfinite(position) || !error_samples ||
        error_sample_count != 1001 || !output) return REMAGX_INVALID_ARGUMENT;
    if (layer_count > std::numeric_limits<size_t>::max() / (18 * sizeof(double))) return REMAGX_ALLOCATION_ERROR;
    for (size_t layer = 0; layer < layer_count; ++layer) {
        const auto& row = layers[layer];
        if (!std::isfinite(row.thickness) || row.thickness < 0 || !std::isfinite(row.roughness) || row.roughness < 0 ||
            !std::isfinite(row.delta) || !std::isfinite(row.beta) || !std::isfinite(row.delta_magnetic) ||
            !std::isfinite(row.beta_magnetic) || (model == 0 && !std::isfinite(boundaries[layer]))) return REMAGX_INVALID_ARGUMENT;
        if (tensor_state) for (size_t component = 0; component < 18; ++component)
            if (!std::isfinite(tensors[layer * 18 + component])) return REMAGX_INVALID_ARGUMENT;
    }
    for (size_t index = 0; index < error_sample_count; ++index)
        if (!std::isfinite(error_samples[index])) return REMAGX_INVALID_ARGUMENT;
    double scalar[4] = {}, result_tensor[18] = {}, tensor_sum[18] = {};
    if (tensor_state) for (size_t component = 0; component < 18; ++component) {
        if (!std::isfinite(tensor_state[component])) return REMAGX_INVALID_ARGUMENT;
        result_tensor[component] = tensor_state[component];
    }
    const double factor = 1.0 / std::sqrt(2.0);
    double boundary = 0.0, total_weight = 0.0;
    for (size_t layer = 0; layer < layer_count; ++layer) {
        const auto& row = layers[layer];
        const double current[4] = {row.delta, row.beta, row.delta_magnetic, row.beta_magnetic};
        if (model == 2) {
            if (layer == layer_count - 1) {
                for (size_t component = 0; component < 4; ++component) scalar[component] += current[component];
                if (tensor_state) for (size_t component = 0; component < 18; ++component)
                    result_tensor[component] += tensors[layer * 18 + component];
                break;
            }
            if (!std::isfinite(boundary)) return REMAGX_NUMERICAL_ERROR;
            const auto& next = layers[layer + 1];
            const double following[4] = {next.delta, next.beta, next.delta_magnetic, next.beta_magnetic};
            const double width = row.roughness == 0.0 ? 1e-10 : row.roughness;
            const double denominator = 1.0 + errorFunction(-(position - boundary) / width * factor, error_samples);
            for (size_t component = 0; component < 4; ++component)
                scalar[component] += 0.5 * (current[component] - following[component]) * denominator;
            if (tensor_state) for (size_t component = 0; component < 18; ++component)
                result_tensor[component] += (tensors[layer * 18 + component] - tensors[(layer + 1) * 18 + component]) * 0.5 * denominator;
            boundary += next.thickness;
            continue;
        }
        double weight;
        if (model == 0) {
            weight = 1.0;
            for (size_t interface = 0; interface < layer_count - 1; ++interface) {
                const double width = layers[interface].roughness == 0.0 ? 1e-10 : layers[interface].roughness;
                const double lookup = errorFunction((position - boundaries[interface]) / width * factor, error_samples);
                weight *= boundaries[layer] > boundaries[interface] ? 0.5 * (1.0 + lookup) : 0.5 * (1.0 - lookup);
            }
        } else if (layer == 0) {
            const double width = row.roughness == 0.0 ? 1e-10 : row.roughness;
            weight = 0.25 * ((1.0 - errorFunction((position - boundary) / width * factor, error_samples)) * (1.0 + 1.0));
        } else {
            const double lower_width = layers[layer - 1].roughness == 0.0 ? 1e-10 : layers[layer - 1].roughness;
            if (layer == layer_count - 1) {
                weight = 0.25 * ((1.0 + 1.0) * (1.0 + errorFunction((position - boundary) / lower_width * factor, error_samples)));
            } else {
                const double upper_width = row.roughness == 0.0 ? 1e-10 : row.roughness;
                const double upper = boundary + row.thickness;
                if (!std::isfinite(upper)) return REMAGX_NUMERICAL_ERROR;
                weight = 0.25 * ((1.0 - errorFunction((position - upper) / upper_width * factor, error_samples)) *
                    (1.0 + errorFunction((position - boundary) / lower_width * factor, error_samples)));
            }
        }
        total_weight += weight;
        for (size_t component = 0; component < 4; ++component) scalar[component] += current[component] * weight;
        if (tensor_state) for (size_t component = 0; component < 18; ++component)
            tensor_sum[component] += tensors[layer * 18 + component] * weight;
        if (model == 1 && layer > 0 && layer < layer_count - 1) boundary += row.thickness;
        if (!std::isfinite(boundary)) return REMAGX_NUMERICAL_ERROR;
    }
    if (model != 2) {
        if (total_weight != 0.0) {
            for (double& value : scalar) value /= total_weight;
            if (tensor_state) for (size_t component = 0; component < 18; ++component)
                result_tensor[component] = tensor_sum[component] / total_weight;
        } else std::fill(scalar, scalar + 4, 0.0);
    }
    for (double value : scalar) if (!std::isfinite(value)) return REMAGX_NUMERICAL_ERROR;
    if (tensor_state) for (double value : result_tensor) if (!std::isfinite(value)) return REMAGX_NUMERICAL_ERROR;
    std::copy(scalar, scalar + 4, output);
    if (tensor_state) std::copy(result_tensor, result_tensor + 18, tensor_state);
    return REMAGX_SUCCESS;
}
