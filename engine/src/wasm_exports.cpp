#include "remagx/core.h"
// The JavaScript bridge packs consecutive IEEE double values into these structs.
static_assert(sizeof(RemagxLayer) == 8 * sizeof(double));
static_assert(sizeof(RemagxBeam) == 4 * sizeof(double));
static_assert(sizeof(RemagxParrattPoint) == 3 * sizeof(double));
static_assert(sizeof(size_t) == 4);
static_assert(sizeof(int) == 4); // enabled-point mask uses DataView.setInt32
static_assert(sizeof(RemagxReflectivity) == 2 * sizeof(double));

static_assert(offsetof(RemagxMatrixLayer, anisotropic) == 22 * sizeof(double));
static_assert(sizeof(RemagxMatrixLayer) == 23 * sizeof(double));

static_assert(sizeof(RemagxGaussianProfile) == 4 * sizeof(double));
