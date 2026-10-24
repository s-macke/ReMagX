#pragma once
#include "remagx/core.h"
#include "remagx/project_document.hpp"
#include <vector>
namespace remagx {
void prepare_project_elements(const ProjectDocument& project, double energy,
    std::vector<RemagxLayer>& layers, std::vector<RemagxMatrixLayer>& matrix);
}
