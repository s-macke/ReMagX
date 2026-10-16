#ifndef REMAGX_CORE_H
#define REMAGX_CORE_H
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct RemagxLayer {
    double thickness;
    double roughness;
    double delta;
    double beta;
    double delta_magnetic;
    double beta_magnetic;
    double gamma_degrees;
    double phi_degrees;
} RemagxLayer;

typedef struct RemagxBeam {
    double sigma_real;
    double sigma_imaginary;
    double pi_real;
    double pi_imaginary;
} RemagxBeam;

typedef struct RemagxParrattPoint {
    double angle_radians;
    double vacuum_wave_number;
    double magnetization;
} RemagxParrattPoint;

enum RemagxStatus {
    REMAGX_SUCCESS = 0,
    REMAGX_INVALID_ARGUMENT = 1,
    REMAGX_NUMERICAL_ERROR = 2,
    REMAGX_ALLOCATION_ERROR = 3
};
enum RemagxTensor { REMAGX_ISOTROPIC = 0, REMAGX_TETRAGONAL = 1 };
enum RemagxAnalyzer { REMAGX_BOTH = 0, REMAGX_SIGMA = 1, REMAGX_PI = 2 };

// Prepared layers: substrate first, ambient last; thickness/roughness in Angstrom.
// Beam amplitudes are used as supplied, without normalization. No global state.
// Output must not overlap the input arrays.
// Output has point_count doubles and is unchanged on failure. Inputs are read-only.
// No table refresh, slicing, Lua, resolution convolution or qz conversion occurs here.
int remagx_parratt(const RemagxLayer* layers, size_t layer_count,
                   const RemagxParrattPoint* points, size_t point_count,
                   const RemagxBeam* beam, int tensor, int analyzer, double* output);
#ifdef __cplusplus
}
#endif
#endif
