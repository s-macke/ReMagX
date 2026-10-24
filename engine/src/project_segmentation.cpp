#include "project_segmentation.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <memory>

namespace remagx {
namespace {
void check(int status) {
    if (status != REMAGX_SUCCESS) throw ProjectDocumentError(
        status == REMAGX_ALLOCATION_ERROR ? "Insufficient adaptive-segmentation memory." :
        status == REMAGX_NUMERICAL_ERROR ? "Adaptive optical sampling failed numerically." :
        "Invalid adaptive-segmentation arguments or layer limit exceeded.");
}
struct SampleState {
    const RemagxSegmentedOptics* sampler;
    bool tensors;
    std::array<std::array<double, 18>, 4> slots{};
};
int sample(double position, size_t slot, double* values, void* context) {
    auto& state = *static_cast<SampleState*>(context);
    if (slot >= state.slots.size()) return REMAGX_INVALID_ARGUMENT;
    auto* tensor = state.tensors ? state.slots[slot].data() : nullptr;
    const int status = remagx_segmented_optics_sample(state.sampler, position, values, tensor);
    if (status == REMAGX_SUCCESS && tensor) std::copy(tensor, tensor + 18, values + 4);
    return status;
}
}
void segment_project_layers(const ProjectDocument& project, std::vector<RemagxLayer>& layers,
                            std::vector<RemagxMatrixLayer>& matrix) {
    if (layers.size() < 2 || (!matrix.empty() && matrix.size() != layers.size()))
        throw ProjectDocumentError("Invalid compound segmentation stack.");
    const double minimum_step = project.number("/calculation/segmentation/minThickness");
    const double maximum_step = project.number("/calculation/segmentation/maxThickness");
    if (minimum_step <= 0 || maximum_step < minimum_step)
        throw ProjectDocumentError("Segmentation requires positive minimum thickness and maximum >= minimum.");
    const int model = project.string("/calculation/segmentation/scope") == "global" ? 1 : 2;
    double thickness = 0;
    for (size_t index = 1; index + 1 < layers.size(); ++index) thickness += layers[index].thickness;
    const double minimum = layers.front().roughness > 10 ? -layers.front().roughness * 3 : -30;
    const double terminal_roughness = layers[layers.size() - 2].roughness;
    const double maximum = thickness + (terminal_roughness > 10 ? terminal_roughness * 3 : 30);
    if (!std::isfinite(minimum) || !std::isfinite(maximum))
        throw ProjectDocumentError("Segmentation depth range exceeds the finite double range.");
    std::array<double, 1001> error_samples;
    check(remagx_error_function_lookup(error_samples.data(), error_samples.size()));
    std::vector<double> tensor_values;
    bool anisotropic = false;
    if (!matrix.empty()) {
        tensor_values.reserve(matrix.size() * 18);
        for (size_t index = 0; index < matrix.size(); ++index) {
            tensor_values.insert(tensor_values.end(), matrix[index].dielectric, matrix[index].dielectric + 18);
            // Original classification scan excludes ambient.
            if (index + 1 < matrix.size() && matrix[index].anisotropic) anisotropic = true;
        }
    }
    RemagxSegmentedOptics* raw = nullptr;
    check(remagx_segmented_optics_prepare(layers.data(), layers.size(), nullptr,
        matrix.empty() ? nullptr : tensor_values.data(), model, error_samples.data(), error_samples.size(), &raw));
    const std::unique_ptr<RemagxSegmentedOptics, decltype(&remagx_segmented_optics_destroy)> sampler(raw, remagx_segmented_optics_destroy);
    SampleState state{sampler.get(), !matrix.empty(), {}};
    constexpr size_t capacity = 1000000;
    const size_t width = matrix.empty() ? 4 : 22;
    std::vector<double> positions(capacity), thicknesses(capacity), values(capacity * width);
    size_t count = 0;
    check(remagx_adaptive_segments(minimum, maximum, minimum_step, maximum_step,
        project.number("/calculation/segmentation/gradientScale"), width, sample, &state, capacity,
        positions.data(), thicknesses.data(), values.data(), &count));
    if (count < 2) throw ProjectDocumentError("Single-row segmentation is unavailable pending homogeneous-medium semantics review.");
    std::vector<RemagxLayer> generated;
    std::vector<RemagxMatrixLayer> generated_matrix;
    generated.reserve(count);
    if (!matrix.empty()) generated_matrix.reserve(count);
    for (size_t index = 0; index < count; ++index) {
        const auto* row = values.data() + index * width;
        generated.push_back({thicknesses[index], 0, row[0], row[1], row[2], row[3], 90, 90});
        if (!matrix.empty()) {
            RemagxMatrixLayer layer{};
            layer.thickness = thicknesses[index]; layer.roughness = 0;
            layer.index_real = 1 - row[0]; layer.index_imaginary = row[1];
            std::copy(row + 4, row + 22, layer.dielectric);
            layer.anisotropic = index > 0 && index + 1 < count && anisotropic ? 1 : 0;
            generated_matrix.push_back(layer);
        }
    }
    layers = std::move(generated);
    matrix = std::move(generated_matrix);
}
}
