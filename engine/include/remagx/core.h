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
// Scalar FillEpsilonTensor construction, with 18 row-major real/imag doubles.
// Uses delta/beta, magnetic constants and per-layer angles; ignores thickness and
// roughness. anisotropic receives 0 for nonmagnetic isotropic input, otherwise 1
// (including zero magnetic constants and tetragonal input with magnetization off).
// Imported full tensors bypass this construction. Both outputs are unchanged on
// failure and must not overlap each other or the input.
int remagx_dielectric_tensor(const RemagxLayer* layer, int tensor,
                            int magnetization_enabled, double* output, int* anisotropic);
// Visnovsky quartic primitive. Five complex coefficients (degree four to zero)
// and four complex roots, each packed real/imag. Retains analytic branches,
// guarded Newton refinement and legacy mode order (not a general sorted order).
// Reproduces legacy behavior; general complex quartics can retain large residuals.
// Leading coefficient must be nonzero. Output is untouched on any error and
// must not overlap the coefficients. Degenerate nonfinite roots report error 2.
int remagx_quartic_roots(const double* coefficients, double* output);
// Anisotropic Maxwell polynomial from a row-major complex dielectric tensor
// (18 doubles) and angle in radians. Coefficients are 10 real/imag doubles in
// descending degree order; roots are 8 doubles in legacy quartic mode order.
// These primitives do not apply isotropic/tetragonal shortcuts or form mode
// vectors. They retain the quartic routine's documented residual limitations.
// Outputs remain unchanged on failure and must not overlap the tensor input.
int remagx_maxwell_polynomial(const double* tensor, double angle_radians, double* coefficients);
int remagx_maxwell_roots(const double* tensor, double angle_radians, double* roots);
// Legacy dielectric classification (distinct from scalar tensor construction mode).
// Strict norm threshold: zero or negative finite epsilon classifies anisotropic.
enum RemagxMatrixKind { REMAGX_MATRIX_ISOTROPIC = 0, REMAGX_MATRIX_ANISOTROPIC = 1,
                        REMAGX_MATRIX_TETRAGONAL = 2 };
int remagx_classify_tensor(const double* tensor, double epsilon, int* kind);
// Analytic mode shortcuts only; kind must be ISOTROPIC or TETRAGONAL.
// Isotropic uses the supplied complex refractive index; tetragonal uses tensor.
// Caller selecting isotropic after classification supplies sqrt(tensor[0,0]).
// Angles are radians, wave number inverse Angstrom, thickness Angstrom.
// Output: 8 root doubles, 32 boundary-matrix doubles, 32 propagation doubles;
// matrices row-major complex real/imag in legacy CMATRIX storage: its
// SetMatrixLine writes a column, so boundary rows are modes and columns
// are field components. Buffers must not overlap. All outputs
// remain untouched on error. General anisotropic mode vectors are not provided.
int remagx_analytic_modes(int kind, const double* tensor, const double* refractive_index,
                         double angle, double wave_number, double thickness,
                         double* roots, double* boundary, double* propagation);
// Complete single-layer Visnovsky mode dispatch. anisotropic is a 0/1 flag:
// zero uses the supplied refractive index; one classifies the supplied tensor
// using epsilon, derives sqrt(epsilon_xx) for its isotropic shortcut, or forms
// general normalized cofactor eigenvectors from the legacy quartic roots.
// Same output layout and non-overlap/atomic-error contract as analytic_modes.
// Degenerate eigenvectors report numerical error; no alternative physics is used.
int remagx_matrix_modes(int anisotropic, const double* tensor, const double* refractive_index,
                        double epsilon, double angle, double wave_number, double thickness,
                        double* roots, double* boundary, double* propagation);
// Single-layer Zak boundary/propagation matrices. Angles (including gamma/phi)
// are radians; index and magnetic constant are complex real/imag pairs. The
// caller supplies Q = 2*(-delta_m + i*beta_m), or zero when magnetism is disabled.
// Outputs: 2 root doubles and two row-major complex matrices of 32 doubles each.
// Matches legacy column storage and angle clamp. For zero thickness propagation
// is NOT written: the stack caller must retain its previous matrix, as legacy does.
// Buffers must not overlap. All outputs remain untouched on failure.
int remagx_zak_modes(const double* refractive_index, const double* magnetic_constant,
                     double angle, double gamma, double phi, double wave_number,
                     double thickness, double* root, double* boundary, double* propagation);
// Single-angle Zak reflection for substrate-first scalar layers, ambient last.
// Both supplied complex beams use the same magnetic stack; magnetic_enabled is
// 0 or 1. Angles on layers are degrees; angle is radians and wave_number is 1/A.
// Substrate/ambient thickness is ignored. Zero-thickness internal layers retain
// the previous propagation matrix, including its initial zeros, as in legacy.
// No determinant clamp, transmission, table refresh, convolution or slicing.
// Finite inputs and at least two layers required; output is atomic on error.
int remagx_zak(const RemagxLayer* layers, size_t layer_count, double angle,
                double wave_number, int magnetic_enabled, const RemagxBeam* beam1,
                const RemagxBeam* beam2, int analyzer, RemagxReflectivity* output);
// Prepared substrate-first matrix stack, including ambient as the last layer.
// Tensor entries are packed row-major complex real/imag; anisotropic is 0/1.
// Scalars supply the isotropic index directly. Tensors are already constructed
// or imported for the current energy and magnetization; no preparation occurs.
typedef struct RemagxMatrixLayer {
    double thickness;
    double roughness;
    double index_real;
    double index_imaginary;
    double dielectric[18];
    int anisotropic;
} RemagxMatrixLayer;
// Single-angle full-stack Visnovsky reflection (no transmission). Returns both
// supplied beams without changing magnetization between them. Angle is radians,
// wave number inverse Angstrom. No scan convolution or postprocessing is applied.
// Substrate/ambient thickness is ignored. Finite values and at least two layers
// are required. Output must not overlap inputs and remains untouched on failure.
int remagx_visnovsky(const RemagxMatrixLayer* layers, size_t layer_count,
                     double angle, double wave_number, double epsilon,
                     const RemagxBeam* beam1, const RemagxBeam* beam2,
                     int analyzer, RemagxReflectivity* output);
// Fixed-energy qz scan of already-prepared tensors. Both beams use the same
// stack (legacy matrix dichroism does not reverse tensors for the second beam).
// Monochromatic mode accepts a null beam2 and returns zero in its output column.
// Coordinates retain input order; negative coordinates are skipped. Legacy qz
// bounds differ by mode, as in the Parratt APIs. Outputs are atomic on error.
int remagx_visnovsky_qz(const RemagxMatrixLayer* layers, size_t layer_count,
                       const double* qz, size_t point_count, double energy_ev, double epsilon,
                       const RemagxBeam* beam1, const RemagxBeam* beam2,
                       int analyzer, int scan_mode, RemagxReflectivity* output);
// Same exact/fast 19-sample angular convolution contract as Parratt resolution.
int remagx_visnovsky_qz_resolution(const RemagxMatrixLayer* layers, size_t layer_count,
                       const double* qz, size_t point_count, double energy_ev, double epsilon,
                       const RemagxBeam* beam1, const RemagxBeam* beam2, int analyzer,
                       int scan_mode, double width, int fast, RemagxReflectivity* output);
// Prepared matrix energy scan: one consecutive substrate-first stack per point.
// Tensors/indices have already been refreshed for each energy. enabled is null
// (all points) or a 0/1 mask; disabled stacks are not read and retain intensity
// one (beam2 zero for monochromatic). Exact angular convolution precedes energy
// convolution over the complete scan, then caller postprocessing/asymmetry.
// Both beams use each point's same tensor stack. Output is unchanged on failure.
int remagx_visnovsky_energy_scan(const RemagxMatrixLayer* layers, size_t layer_count,
                       const double* energies, const double* qz, const int* enabled, size_t point_count,
                       double epsilon, const RemagxBeam* beam1, const RemagxBeam* beam2,
                       int analyzer, int scan_mode, double angular_width, double energy_width,
                       RemagxReflectivity* output);
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
