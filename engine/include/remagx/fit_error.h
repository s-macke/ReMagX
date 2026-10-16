#ifndef REMAGX_FIT_ERROR_H
#define REMAGX_FIT_ERROR_H
#include "remagx/core.h"
#ifdef __cplusplus
extern "C" {
#endif
enum RemagxFitErrorMode {
    REMAGX_FIT_REFLECTIVITY_LOG = 0,
    REMAGX_FIT_REFLECTIVITY_LINEAR = 1,
    REMAGX_FIT_ASYMMETRY = 2,
    REMAGX_FIT_DICHROIC = 3,
    REMAGX_FIT_ENERGY_LOG = 4,
    REMAGX_FIT_ENERGY_LINEAR = 5,
    REMAGX_FIT_ENERGY_ASYMMETRY = 6,
    REMAGX_FIT_ENERGY_DICHROIC = 7
};
// Prepared, aligned measurements and calculations, already adapted/postprocessed.
// All provided numeric inputs must be finite. qz is required for every mode;
// energy is read/required only for ENERGY_LOG/LINEAR. Secondary arrays are read/
// required only for DICHROIC/ENERGY_DICHROIC. count may be zero (arrays then optional).
// Windows are inclusive; inverted windows accept no points. As in legacy CError,
// linear reflectivity also skips nonpositive measured/calculated intensities.
// Dichroic rows require all four intensities positive, sum both squared log10
// differences and divide by accepted rows. Asymmetry accepts signed values.
// No accepted rows returns zero. This is a dataset mean, without dataset weight
// or Qerror regularization. It is not a statistical reduced chi-square.
// Optional residuals is an in/out array of count doubles: accepted rows receive
// measured-minus-calculated (log10 for logarithmic modes), or the sum of absolute
// beam log10 differences for dichroic data; skipped rows retain their input value.
// On failure all outputs remain unchanged; inputs and outputs must not overlap.
int remagx_fit_dataset_error(int mode, const double* qz, const double* energy,
    const double* measured, const double* calculated,
    const double* measured_second, const double* calculated_second, size_t count,
    double qz_min, double qz_max, double energy_min, double energy_max,
    double* error, size_t* accepted, double* residuals);
#ifdef __cplusplus
}
#endif
#endif
