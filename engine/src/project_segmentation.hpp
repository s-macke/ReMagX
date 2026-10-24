#pragma once
#include "remagx/core.h"
#include "remagx/project_document.hpp"
#include <vector>
namespace remagx {
// Atomically replace an expanded stack with adaptive samples. Matrix tensors
// are supplied before sampling; scalar solvers pass an empty matrix vector.
void segment_project_layers(const ProjectDocument& project, std::vector<RemagxLayer>& layers,
                            std::vector<RemagxMatrixLayer>& matrix);
}
