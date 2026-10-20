#ifndef REMAGX_OPTIMIZER_H
#define REMAGX_OPTIMIZER_H
#include "remagx/core.h"
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef int (*RemagxObjective)(const double* parameters, size_t count, void* context, double* value);
typedef int (*RemagxShouldStop)(void* context);
typedef void (*RemagxFitProgress)(const double* best, size_t count, double value,
                                 size_t iterations, size_t evaluations, void* context);
enum RemagxFitTermination {
    REMAGX_FIT_CONVERGED = 0,
    REMAGX_FIT_EVALUATION_LIMIT = 1,
    REMAGX_FIT_ITERATION_LIMIT = 2,
    REMAGX_FIT_STOPPED = 3
};
typedef struct RemagxSimplexOptions {
    size_t max_evaluations;
    size_t max_iterations;
    double parameter_tolerance;
    double objective_tolerance;
} RemagxSimplexOptions;
typedef struct RemagxFitSummary {
    int termination;
    int has_best;
    size_t iterations;
    size_t evaluations;
    double value;
} RemagxFitSummary;

// Unconstrained, deterministic Nelder-Mead with coefficients 1, 2, 1/2, 1/2.
// initial_simplex contains (dimension+1) rows of dimension doubles. The caller
// supplies a nondegenerate simplex and implements parameter bounds/objective scaling.
// Convergence requires both maximum coordinate distance from the best vertex and
// maximum objective difference from it <= their respective absolute tolerances.
// This stopping condition does not certify a global or stationary minimum.
// max_evaluations >= dimension+1; max_iterations > 0; tolerances finite and >= 0.
// Objective returns zero and writes a finite value on success; other returns or
// nonfinite values cause REMAGX_NUMERICAL_ERROR. Callbacks must not throw, retain
// pointers or modify their input arrays. context may be NULL; stop/progress optional.
// Stop is checked before each objective call and iteration; it cannot interrupt a
// running callback. Progress follows initialization and each completed iteration.
// Limits/Stop return REMAGX_SUCCESS with the reason and best evaluated candidate,
// including a trial evaluated during an incomplete iteration. Before any evaluation,
// Stop yields has_best=0/value=0 and leaves best_parameters unchanged.
// Errors leave both outputs unchanged. Inputs/outputs must not overlap. No global state.
int remagx_nelder_mead(const double* initial_simplex, size_t dimension,
                       const RemagxSimplexOptions* options, RemagxObjective objective,
                       RemagxShouldStop should_stop, RemagxFitProgress progress, void* context,
                       double* best_parameters, RemagxFitSummary* summary);
// Thermal simplex comparisons follow Cardoso et al. (1996), equations 9-10.
// True objective values determine reported best/progress, never perturbed scores.
// Temperature advances by temperature_step after each completed simplex iteration,
// clamped at zero. Both settings must be finite and initial temperature >= 0.
// Positive/zero steps are allowed and remain subject to the hard work limits.
// Convergence is tested only at zero temperature. Zero temperature and zero step
// exactly reuse ordinary Nelder-Mead (including no random draws).
// Seeded mt19937 draws map to the open interval (0,1) using (draw+0.5)/2^32.
// This defines reproducibility, not equivalence to the legacy random sequence.
// All callback, atomic-output and budget policies above also apply.
typedef struct RemagxAnnealingOptions {
    RemagxSimplexOptions simplex;
    double temperature;
    double temperature_step;
    uint32_t seed;
} RemagxAnnealingOptions;
int remagx_simplex_annealing(const double* initial_simplex, size_t dimension,
                            const RemagxAnnealingOptions* options, RemagxObjective objective,
                            RemagxShouldStop should_stop, RemagxFitProgress progress, void* context,
                            double* best_parameters, RemagxFitSummary* summary);
#ifdef __cplusplus
}
#endif
#endif
