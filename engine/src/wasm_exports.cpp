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

#include "remagx/optimizer.h"
static_assert(sizeof(RemagxSimplexOptions) == 24);
static_assert(offsetof(RemagxSimplexOptions, max_evaluations) == 0);
static_assert(offsetof(RemagxSimplexOptions, max_iterations) == 4);
static_assert(offsetof(RemagxSimplexOptions, parameter_tolerance) == 8);
static_assert(offsetof(RemagxSimplexOptions, objective_tolerance) == 16);
static_assert(sizeof(RemagxFitSummary) == 24);
static_assert(offsetof(RemagxFitSummary, termination) == 0);
static_assert(offsetof(RemagxFitSummary, has_best) == 4);
static_assert(offsetof(RemagxFitSummary, iterations) == 8);
static_assert(offsetof(RemagxFitSummary, evaluations) == 12);
static_assert(offsetof(RemagxFitSummary, value) == 16);

static_assert(sizeof(RemagxAnnealingOptions) == 48);
static_assert(offsetof(RemagxAnnealingOptions, simplex) == 0);
static_assert(offsetof(RemagxAnnealingOptions, temperature) == 24);
static_assert(offsetof(RemagxAnnealingOptions, temperature_step) == 32);
static_assert(offsetof(RemagxAnnealingOptions, seed) == 40);
