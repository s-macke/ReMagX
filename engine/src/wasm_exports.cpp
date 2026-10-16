#include "remagx/core.h"
// The JavaScript bridge packs consecutive IEEE double values into these structs.
static_assert(sizeof(RemagxLayer) == 8 * sizeof(double));
static_assert(sizeof(RemagxBeam) == 4 * sizeof(double));
static_assert(sizeof(RemagxParrattPoint) == 3 * sizeof(double));
static_assert(sizeof(size_t) == 4);
