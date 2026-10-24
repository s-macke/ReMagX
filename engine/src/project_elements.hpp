#pragma once
#include "remagx/core.h"
#include "remagx/project_document.hpp"
#include <vector>
#include <array>
#include "remagx/optical_tables.hpp"
namespace remagx {
struct ElementOpticalState {
    std::vector<std::array<double, 4>> factors;
    std::vector<double> tensors;
    std::vector<size_t> cursors;
};
bool prepare_project_elements(const ProjectDocument& project, double energy,
    std::vector<RemagxLayer>& layers, std::vector<RemagxMatrixLayer>& matrix,
    const std::vector<OpticalTable>& tables, std::vector<std::string>& warnings, ElementOpticalState* previous, bool energy_point = false, bool refresh_only = false, bool strict_refresh = false);
}
