#include "complex_primitives.h"
#include <complex.h>
#include <string.h>
static double complex input_value(double real, double imaginary) {
    // C guarantees the representation of complex double as two doubles.
    // Copying preserves signed zero without relying on compiler extensions.
    const double components[2] = {real, imaginary};
    double complex value;
    memcpy(&value, components, sizeof(value));
    return value;
}
struct RemagxComplexValue remagx_complex_square_root(double real, double imaginary) {
    const double complex result = csqrt(input_value(real, imaginary));
    const struct RemagxComplexValue output = {creal(result), cimag(result)};
    return output;
}
struct RemagxComplexValue remagx_complex_logarithm(double real, double imaginary) {
    const double complex result = clog(input_value(real, imaginary));
    const struct RemagxComplexValue output = {creal(result), cimag(result)};
    return output;
}
