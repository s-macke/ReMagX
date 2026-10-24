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
bool prepare_project_elements(const ProjectDocument& project, double energy,
    std::vector<RemagxLayer>& layers, std::vector<RemagxMatrixLayer>& matrix,
    const std::vector<OpticalTable>& tables, std::vector<std::string>& warnings, ElementOpticalState* previous, bool energy_point, bool refresh_only, bool strict_refresh, bool prepared_optics) {
    const bool automatic = !prepared_optics && (energy_point || strict_refresh || project.boolean("/calculation/automaticOpticalConstants"));
    const double step = project.number("/calculation/segmentation/minThickness");
    const double tolerance = project.number("/calculation/segmentation/tolerance");
    require(step > 0, "Element depth grid requires a positive step.");
    const bool use_matrix = project.string("/calculation/algorithm") == "matrix";
    const double gamma = project.number("/calculation/magnetization/direction/gamma");
    const double phi = project.number("/calculation/magnetization/direction/phi");
    const size_t count = project.array_size("/sample/elementProfiles");
    require(count <= 100000, "Element count exceeds the supported limit.");
    std::vector<Element> elements;
    std::vector<double> tensors(count * 18, 0);
    const bool continuing = previous && previous->factors.size() == count && previous->tensors.size() == count * 18;
    auto cursors = continuing ? previous->cursors : std::vector<size_t>(tables.size(), 0);
    const double lookup_energy = 12398.326 / (12398.326 / energy);
    const auto find_table = [&](const std::string& name, const std::string& kind) {
        for (size_t index = 0; index < tables.size(); ++index)
            if (!name.empty() && tables[index].name == name && tables[index].kind == kind) return index;
        return tables.size();
    };
    const auto read = [&](size_t index) {
        std::array<double, 2> values{};
        if (index == tables.size() || tables[index].energies.empty()) return values;
        const auto& table = tables[index];
        require(table.width == 2 && table.values.size() == table.energies.size() * 2, "Invalid element table shape.");
        checked(remagx_table_lookup(table.energies.data(), table.values.data(), table.energies.size(), 2,
            &lookup_energy, 1, &cursors[index], values.data()));
        return values;
    };
    bool range_error = false;
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
        if (!energy_point && project.contains(path + "/scatteringTensor"))
            for (size_t component = 0; component < 18; ++component)
                tensors[index * 18 + component] = project.number(path + "/scatteringTensor/" + std::to_string(component));
        if (continuing) {
            element.factors = previous->factors[index];
            std::copy_n(previous->tensors.data() + index * 18, 18, tensors.data() + index * 18);
        }
        if (automatic) {
            const auto name = project.string(path + "/element");
            const size_t primary = find_table(name, "ff");
            const std::string label = "Element " + std::to_string(index);
            if (primary == tables.size() || tables[primary].energies.empty()) {
                range_error = true;
                warnings.push_back(label + ": missing/empty .ff table; saved optical state retained.");
            } else if (lookup_energy < tables[primary].energies.front() || lookup_energy > tables[primary].energies.back()) {
                range_error = true;
                warnings.push_back(label + ": energy outside .ff table; saved optical state retained.");
            } else {
                const size_t full = find_table(name, "f");
                require(full == tables.size() || tables[full].energies.empty(),
                    "Full .F scattering tensor refresh is unavailable pending the legacy element-assignment decision.");
                const auto scalar = read(primary), magnetic = read(find_table(name, "ffm"));
                element.factors = {scalar[0], scalar[1], magnetic[0], magnetic[1]};
                checked(remagx_scattering_tensor(element.factors.data(), gamma, phi,
                    project.string("/calculation/tensorContribution") == "tetragonal" ? REMAGX_TETRAGONAL : REMAGX_ISOTROPIC,
                    project.string("/calculation/magnetization/mode") == "none" ? 0 : 1, tensors.data() + index * 18));
            }
        }
        elements.push_back(std::move(element));
    }
    require(!strict_refresh || !range_error, "Strict element optical refresh requires all primary tables in range.");
    if (refresh_only || (energy_point && range_error)) {
        if (previous) {
            previous->factors.clear();
            for (const auto& element : elements) previous->factors.push_back(element.factors);
            previous->tensors = std::move(tensors); previous->cursors = std::move(cursors);
        }
        return refresh_only;
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
    const double factor = (.0004151761541 * 1e6) / (lookup_energy * lookup_energy);
    require(std::isfinite(factor), "Invalid element calculation energy.");
    std::array<double, 1001> lookup{};
    checked(remagx_error_function_lookup(lookup.data(), lookup.size()));
    std::array<double, 4> previous_scalar{-1e99, -1e99, -1e99, -1e99};
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
                changed = changed || std::abs(previous_scalar[component] - scalar[component]) > tolerance;
            if (changed) {
                previous_scalar = scalar;
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
    if (previous) {
        previous->factors.clear();
        for (const auto& element : elements) previous->factors.push_back(element.factors);
        previous->tensors = std::move(tensors); previous->cursors = std::move(cursors);
    }
    layers = std::move(prepared); matrix = std::move(prepared_matrix);
    return true;
}
}
