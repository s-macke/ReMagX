#include "complex_primitives.h"
#include <complex.h>
#include <string.h>
#ifdef REMAGX_REFERENCE_MATH
extern double complex remagx_reference_math_csqrt(double complex);
extern double complex remagx_reference_math_clog(double complex);
#define reference_logarithm remagx_reference_math_clog
#define reference_square_root remagx_reference_math_csqrt
#else
#define reference_square_root csqrt
#define reference_logarithm clog
#endif
static double complex input_value(double real, double imaginary) {
    // C guarantees the representation of complex double as two doubles.
    // Copying preserves signed zero without relying on compiler extensions.
    const double components[2] = {real, imaginary};
    double complex value;
    memcpy(&value, components, sizeof(value));
    return value;
}
struct RemagxComplexValue remagx_complex_square_root(double real, double imaginary) {
    const double complex result = reference_square_root(input_value(real, imaginary));
    const struct RemagxComplexValue output = {creal(result), cimag(result)};
    return output;
}
struct RemagxComplexValue remagx_complex_logarithm(double real, double imaginary) {
    const double complex result = reference_logarithm(input_value(real, imaginary));
    const struct RemagxComplexValue output = {creal(result), cimag(result)};
    return output;
}
