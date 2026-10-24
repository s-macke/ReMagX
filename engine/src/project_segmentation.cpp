#include "project_segmentation.hpp"
#include "remagx/compound_layers.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <limits>
#include <numeric>

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
void apply_profiles(const ProjectDocument& project, std::vector<RemagxLayer>& generated,
                    const std::vector<double>& positions, const std::vector<RemagxLayer>& original,
                    const std::array<double, 1001>& error_samples, const std::vector<double>* prepared_depths) {
    std::vector<size_t> active;
    const size_t profile_count = project.array_size("/sample/depthProfileFunctions");
    for (size_t index = 0; index < profile_count; ++index) {
        const auto path = "/sample/depthProfileFunctions/" + std::to_string(index);
        if (project.number(path + "/deltaAmplitude") == 0 && project.number(path + "/betaAmplitude") == 0) continue;
        if (!project.is_null(path + "/boundToLayer") && project.number(path + "/boundToLayer") == static_cast<double>(generated.size())) continue;
        active.push_back(index);
    }
    if (active.empty()) return;
    const size_t stored_count = project.array_size("/sample/layers");
    std::vector<double> stored_depths = prepared_depths ? *prepared_depths : std::vector<double>(stored_count, 0);
    if (stored_depths.size() != stored_count || !std::all_of(stored_depths.begin(), stored_depths.end(), [](double value) {return std::isfinite(value);}))
        throw ProjectDocumentError("Stored layer depths must match the compound layer count.");
    for (size_t index = 1; !prepared_depths && index < stored_count; ++index) {
        stored_depths[index] = stored_depths[index - 1] + project.number("/sample/layers/" + std::to_string(index) + "/thickness");
        if (!std::isfinite(stored_depths[index])) throw ProjectDocumentError("Stored layer depth exceeds the finite double range.");
    }
    std::vector<size_t> indices;
    if (project.boolean("/sample/multilayer/enabled"))
        indices = compound_layer_indices(stored_count, project.string("/sample/multilayer/pattern"));
    else { indices.resize(stored_count); std::iota(indices.begin(), indices.end(), 0); }
    std::vector<double> boundaries, roughness;
    boundaries.reserve(indices.size()); roughness.reserve(indices.size());
    for (size_t index = 0; index < indices.size(); ++index) {
        boundaries.push_back(stored_depths[indices[index]]);
        roughness.push_back(original[index].roughness);
    }
    const size_t samples = generated.size() - 1;
    if (active.size() > std::numeric_limits<size_t>::max() / samples)
        throw ProjectDocumentError("Magnetic-profile weights exceed the supported size.");
    std::vector<double> midpoints(samples), initial(samples * 2), output(samples * 2);
    for (size_t index = 0; index < samples; ++index) {
        midpoints[index] = (positions[index] + positions[index + 1]) * 0.5;
        if (!std::isfinite(midpoints[index])) throw ProjectDocumentError("Magnetic-profile midpoint overflow.");
        initial[2 * index] = generated[index + 1].delta_magnetic;
        initial[2 * index + 1] = generated[index + 1].beta_magnetic;
    }
    std::vector<double> weights(samples * active.size(), 1), knots, ordinates;
    std::vector<int> spline_counts;
    std::vector<RemagxGaussianProfile> profiles;
    for (size_t column = 0; column < active.size(); ++column) {
        const auto path = "/sample/depthProfileFunctions/" + std::to_string(active[column]);
        profiles.push_back({project.number(path + "/center"), project.number(path + "/width"),
            project.number(path + "/deltaAmplitude"), project.number(path + "/betaAmplitude")});
        if (!project.is_null(path + "/boundToLayer")) {
            const double binding = project.number(path + "/boundToLayer");
            if (binding >= static_cast<double>(boundaries.size()))
                throw ProjectDocumentError("Legacy magnetic-profile binding is outside the original layer stack.");
            const size_t layer_index = boundaries.size() - static_cast<size_t>(binding) - 1;
            std::vector<double> density(samples);
            check(remagx_layer_density(boundaries.data(), roughness.data(), boundaries.size(), layer_index,
                midpoints.data(), samples, error_samples.data(), error_samples.size(), density.data()));
            for (size_t index = 0; index < samples; ++index) weights[index * active.size() + column] = density[index];
        }
        if (project.boolean(path + "/spline/enabled")) {
            const size_t count = project.array_size(path + "/spline/points");
            if (count > static_cast<size_t>(std::numeric_limits<int>::max()))
                throw ProjectDocumentError("Magnetic spline has too many knots.");
            spline_counts.push_back(static_cast<int>(count));
            for (size_t index = 0; index < count; ++index) {
                const auto point = path + "/spline/points/" + std::to_string(index);
                knots.push_back(project.number(point + "/z"));
                ordinates.push_back(project.number(point + "/value"));
            }
        } else spline_counts.push_back(-1);
    }
    const int status = remagx_apply_magnetic_profiles(profiles.data(), profiles.size(), spline_counts.data(),
        knots.data(), ordinates.data(), knots.size(), midpoints.data(), initial.data(), weights.data(), samples,
        project.string("/calculation/profileCombination") == "sum" ? 0 : 1, output.data());
    if (status != REMAGX_SUCCESS) throw ProjectDocumentError("Magnetic-profile application failed; check spline knots and unsupported endpoint coordinates.");
    for (size_t index = 0; index < samples; ++index) {
        generated[index + 1].delta_magnetic = output[2 * index];
        generated[index + 1].beta_magnetic = output[2 * index + 1];
    }
}

}
void segment_project_layers(const ProjectDocument& project, std::vector<RemagxLayer>& layers,
                            std::vector<RemagxMatrixLayer>& matrix, const std::vector<double>* stored_depths) {
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
    if (project.string("/calculation/magnetization/mode") == "profile")
        apply_profiles(project, generated, positions, layers, error_samples, stored_depths);
    // Original profile application changes magnetic scalars, not the prepared tensors.
    layers = std::move(generated);
    matrix = std::move(generated_matrix);
}
}
