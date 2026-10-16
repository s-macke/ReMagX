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
    REMAGX_ALLOCATION_ERROR = 3,
    REMAGX_QZ_ERROR = 4
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
// Fixed-energy qz scan of an already prepared stack, with zero resolution.
// Preserves the non-fast legacy qz boundary rules and skips negative qz samples.
// No grid generation, table refresh, slicing, scripts or postprocessing occurs here.
// beam2 is required only for dichroic scans. Beam amplitudes are not normalized.
// magnetization_enabled must be 0 or 1; dichroic beams use opposite signs.
// Output has point_count records, does not overlap inputs and is unchanged on failure.
enum RemagxScanMode { REMAGX_MONOCHROMATIC = 0, REMAGX_DICHROIC = 1 };
typedef struct RemagxReflectivity { double beam1; double beam2; } RemagxReflectivity;
int remagx_parratt_qz(const RemagxLayer* layers, size_t layer_count,
                      const double* qz, size_t point_count, double energy_ev,
                      const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int tensor, int analyzer, int magnetization_enabled,
                      int scan_mode, RemagxReflectivity* output);
// Same prepared-stack contract, with the legacy angular-resolution kernel.
// width is in inverse Angstrom; fast is 0 (shifted evaluations) or 1 (interpolation).
// The active kernel has 19 fixed samples. Output remains untouched on any failure.
int remagx_parratt_qz_resolution(const RemagxLayer* layers, size_t layer_count,
                      const double* qz, size_t point_count, double energy_ev,
                      const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int tensor, int analyzer, int magnetization_enabled,
                      int scan_mode, double width, int fast, RemagxReflectivity* output);
// Post-scan legacy energy convolution of both intensity columns, before asymmetry.
// Preserves supplied point order, GetLinY boundary fallback and negative-sample
// omission without renormalization. Width below 1e-10 eV copies inputs unchanged.
// Output has point_count records, must not overlap inputs and is unchanged on error.
int remagx_energy_resolution(const double* energies, const RemagxReflectivity* input,
                            size_t point_count, double width, RemagxReflectivity* output);
// Prepared energy scan: point_count consecutive stacks of layer_count layers,
// already refreshed for each energy, substrate first. Coordinates retain order.
// enabled may be NULL (all points enabled), otherwise contains one 0/1 per point.
// Disabled points retain legacy intensity one (beam2 zero for monochromatic);
// their layers are not read. All points participate in final energy convolution.
// Exact angular convolution is used regardless of the UI fast setting, as in
// CalcEScan/CalcDicEScan. No table lookup, scripting or postprocessing occurs here.
// Output must not overlap any inputs and remains unchanged on every failure.
int remagx_parratt_energy_scan(const RemagxLayer* layers, size_t layer_count,
                      const double* energies, const double* qz, const int* enabled, size_t point_count,
                      const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int tensor, int analyzer, int magnetization_enabled, int scan_mode,
                      double angular_width, double energy_width, RemagxReflectivity* output);
// Legacy CTable::Get lookup on caller-sorted, nondecreasing energies.
// Values and output are row-major; column_count is 1..20. Empty tables and
// out-of-range queries return zeros; exact endpoints return their stored row.
// Cursor is caller-owned state (initially zero), preserving duplicate-energy
// lookup history. It and output remain unchanged on failure. Buffers must not overlap.
int remagx_table_lookup(const double* energies, const double* values, size_t row_count,
                       size_t column_count, const double* queries, size_t query_count,
                       size_t* cursor, double* output);
#ifdef __cplusplus
}
#endif
#endif
