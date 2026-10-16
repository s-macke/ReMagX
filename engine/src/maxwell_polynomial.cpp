#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <complex>

// Anisotropic branch of CVisnovsky.h SetMatrixAnisotropic. The isotropic and
// tetragonal shortcuts, mode vectors and propagation are separate stages.
extern "C" int remagx_maxwell_polynomial(const double* tensor, double angle_radians, double* output) {
    if (!tensor || !output || !std::isfinite(angle_radians)) return REMAGX_INVALID_ARGUMENT;
    using Complex = std::complex<double>;
    Complex dielectric[3][3];
    for (int row = 0; row < 3; ++row) for (int column = 0; column < 3; ++column) {
        const int index = 2 * (row * 3 + column);
        if (!std::isfinite(tensor[index]) || !std::isfinite(tensor[index + 1])) return REMAGX_INVALID_ARGUMENT;
        dielectric[row][column] = Complex(tensor[index], tensor[index + 1]);
    }
    const double tangential = std::cos(angle_radians);
    const Complex leading = dielectric[2][2];
    const Complex cubic = (dielectric[1][2] + dielectric[2][1])*tangential;
    const Complex quadratic = -(dielectric[1][1]*(dielectric[2][2] - tangential*tangential) +
        dielectric[2][2]*(dielectric[0][0] - tangential*tangential) -
        dielectric[0][2]*dielectric[2][0] - dielectric[1][2]*dielectric[2][1]);
    const Complex linear = -((dielectric[0][0] - tangential*tangential)*(dielectric[1][2] + dielectric[2][1]) -
        dielectric[0][1]*dielectric[2][0] - dielectric[1][0]*dielectric[0][2])*tangential;
    const Complex constant = dielectric[1][1]*((dielectric[0][0] - tangential*tangential)*
        (dielectric[2][2] - tangential*tangential) - dielectric[0][2]*dielectric[2][0]) -
        dielectric[0][1]*dielectric[1][0]*(dielectric[2][2] - tangential*tangential) -
        dielectric[1][2]*dielectric[2][1]*(dielectric[0][0] - tangential*tangential) +
        dielectric[0][1]*dielectric[2][0]*dielectric[1][2] + dielectric[1][0]*dielectric[0][2]*dielectric[2][1];
    const Complex coefficients[] = {leading, cubic, quadratic, linear, constant};
    double values[10];
    for (int index = 0; index < 5; ++index) {
        values[index*2] = coefficients[index].real();
        values[index*2+1] = coefficients[index].imag();
        if (!std::isfinite(values[index*2]) || !std::isfinite(values[index*2+1])) return REMAGX_NUMERICAL_ERROR;
    }
    std::copy(values, values + 10, output);
    return REMAGX_SUCCESS;
}

extern "C" int remagx_maxwell_roots(const double* tensor, double angle_radians, double* output) {
    if (!output) return REMAGX_INVALID_ARGUMENT;
    double coefficients[10];
    const int status = remagx_maxwell_polynomial(tensor, angle_radians, coefficients);
    if (status != REMAGX_SUCCESS) return status;
    return remagx_quartic_roots(coefficients, output);
}
