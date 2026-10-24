#include "project_elements.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <string>

namespace remagx {
namespace {
void require(bool condition, const char* message) {
    if (!condition) throw ProjectDocumentError(message);
}
void checked(int status) {
    require(status == REMAGX_SUCCESS, "Element density/optical preparation failed.");
}
struct Element {
    std::vector<double> slabs;
    std::array<double, 4> factors;
    std::array<double, 256> density{};
};
}
void prepare_project_elements(const ProjectDocument& project, double energy,
    std::vector<RemagxLayer>& layers, std::vector<RemagxMatrixLayer>& matrix) {
    require(!project.boolean("/calculation/automaticOpticalConstants"),
        "Native terminal automatic element table refresh is not integrated yet.");
    const double step = project.number("/calculation/segmentation/minThickness");
    const double tolerance = project.number("/calculation/segmentation/tolerance");
    require(step > 0, "Element depth grid requires a positive step.");
    const bool use_matrix = project.string("/calculation/algorithm") == "matrix";
    const double gamma = project.number("/calculation/magnetization/direction/gamma");
    const double phi = project.number("/calculation/magnetization/direction/phi");
    const size_t count = project.array_size("/sample/elementProfiles");
    require(count <= 100000, "Element count exceeds the supported limit.");
    std::vector<Element> elements;
    std::vector<double> tensors(use_matrix ? count * 18 : 0, 0);
    double total_thickness = 0, terminal_roughness = 0;
    for (size_t index = 0; index < count; ++index) {
        const auto path = "/sample/elementProfiles/" + std::to_string(index);
        Element element;
        element.factors = {project.number(path + "/f1"), project.number(path + "/f2"),
            project.number(path + "/f1Mag"), project.number(path + "/f2Mag")};
        const size_t slabs = project.array_size(path + "/slabs");
        require(slabs <= 100000, "Element slab count exceeds the supported limit.");
        double thickness = 0;
        for (size_t slab = 0; slab < slabs; ++slab) {
            const auto row = path + "/slabs/" + std::to_string(slab);
            const double value = project.number(row + "/thickness");
            element.slabs.insert(element.slabs.end(), {value, project.number(row + "/roughness"), project.number(row + "/density")});
            if (slab > 0 && slab + 1 < slabs) thickness += value;
        }
        if (thickness > total_thickness) {
            total_thickness = thickness;
            if (slabs >= 2) terminal_roughness = element.slabs[(slabs - 2) * 3 + 1];
        }
        // Manual calculation preserves stored F, including absent/zero tensors.
        if (use_matrix && project.contains(path + "/scatteringTensor"))
            for (size_t component = 0; component < 18; ++component)
                tensors[index * 18 + component] = project.number(path + "/scatteringTensor/" + std::to_string(component));
        elements.push_back(std::move(element));
    }
    const double maximum_depth = total_thickness + 30 + terminal_roughness * 2;
    require(std::isfinite(maximum_depth), "Element depth range overflow.");
    std::vector<double> depths;
    for (double depth = -30; depth <= maximum_depth;) {
        require(depths.size() < 1000000, "Element sampling exceeds the supported limit.");
        depths.push_back(depth);
        const double next = depth + step;
        require(next > depth, "Element depth grid does not advance.");
        depth = next;
    }
    const double lookup_energy = 12398.326 / (12398.326 / energy);
    const double factor = (.0004151761541 * 1e6) / (lookup_energy * lookup_energy);
    require(std::isfinite(factor), "Invalid element calculation energy.");
    std::array<double, 1001> lookup{};
    checked(remagx_error_function_lookup(lookup.data(), lookup.size()));
    std::array<double, 4> previous{-1e99, -1e99, -1e99, -1e99};
    std::vector<double> packed(count * 5), positions;
    std::vector<RemagxLayer> prepared;
    std::vector<RemagxMatrixLayer> prepared_matrix;
    for (size_t start = 0; start < depths.size(); start += 256) {
        const size_t batch = std::min(size_t{256}, depths.size() - start);
        for (auto& element : elements)
            checked(remagx_element_density(element.slabs.data(), element.slabs.size() / 3,
                depths.data() + start, batch, lookup.data(), lookup.size(), element.density.data()));
        for (size_t sample = 0; sample < batch; ++sample) {
            for (size_t index = 0; index < count; ++index) {
                packed[index * 5] = elements[index].density[sample];
                std::copy(elements[index].factors.begin(), elements[index].factors.end(), packed.begin() + index * 5 + 1);
            }
            std::array<double, 4> scalar{};
            RemagxMatrixLayer matrix_layer{};
            checked(remagx_element_optics(packed.data(), count, factor, tensors.data(), scalar.data(),
                use_matrix ? matrix_layer.dielectric : nullptr));
            bool changed = false;
            for (size_t component = 0; component < 4; ++component)
                changed = changed || std::abs(previous[component] - scalar[component]) > tolerance;
            if (changed) {
                previous = scalar;
                prepared.emplace_back(); positions.push_back(0);
                if (use_matrix) prepared_matrix.emplace_back();
            }
            if (!prepared.empty()) {
                prepared.back() = {0, 0, scalar[0], scalar[1], scalar[2], scalar[3], gamma, phi};
                positions.back() = depths[start + sample];
                if (use_matrix) {
                    matrix_layer.index_real = 1 - scalar[0]; matrix_layer.index_imaginary = scalar[1];
                    matrix_layer.anisotropic = 1;
                    prepared_matrix.back() = matrix_layer;
                }
            }
        }
    }
    require(prepared.size() >= 2, "Single-row element output remains unavailable pending homogeneous-medium semantics review.");
    for (size_t index = 1; index < prepared.size(); ++index) {
        prepared[index].thickness = positions[index] - positions[index - 1];
        if (use_matrix) prepared_matrix[index].thickness = prepared[index].thickness;
    }
    layers = std::move(prepared); matrix = std::move(prepared_matrix);
}
}
