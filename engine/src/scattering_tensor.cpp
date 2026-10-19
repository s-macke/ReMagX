#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <complex>

// MaterialConstantsHelper.cpp FillScatteringTensor: element form factors,
// distinct from refractive-index-squared compound dielectric construction.
extern "C" int remagx_scattering_tensor(const double* factors, double gamma_degrees,
                                        double phi_degrees, int tensor,
                                        int magnetization_enabled, double* output) {
    if (!factors || !output || !std::isfinite(gamma_degrees) || !std::isfinite(phi_degrees) ||
        (tensor != REMAGX_ISOTROPIC && tensor != REMAGX_TETRAGONAL) ||
        (magnetization_enabled != 0 && magnetization_enabled != 1)) return REMAGX_INVALID_ARGUMENT;
    for (int index = 0; index < 4; ++index) {
        if (!std::isfinite(factors[index])) return REMAGX_INVALID_ARGUMENT;
    }
    using Complex = std::complex<double>;
    Complex entries[9] = {};
    entries[0] = entries[4] = entries[8] = Complex(factors[0], factors[1]);
    if (tensor == REMAGX_TETRAGONAL) {
        entries[8] = Complex(factors[2], factors[3]);
    } else if (magnetization_enabled) {
        constexpr double pi = 3.141592653589793238462643383279502884;
        const double gamma = gamma_degrees / 180.0 * pi;
        const double phi = phi_degrees / 180.0 * pi;
        const Complex magnetic = Complex(factors[2], -factors[3]) * Complex(0.0, 1.0);
        entries[2] = std::sin(gamma) * std::sin(phi) * magnetic;
        entries[6] = -std::sin(gamma) * std::sin(phi) * magnetic;
        entries[5] = std::cos(gamma) * std::sin(phi) * magnetic;
        entries[7] = -std::cos(gamma) * std::sin(phi) * magnetic;
        entries[1] = -std::cos(phi) * magnetic;
        entries[3] = std::cos(phi) * magnetic;
    }
    double values[18];
    for (int index = 0; index < 9; ++index) {
        values[2 * index] = entries[index].real();
        values[2 * index + 1] = entries[index].imag();
        if (!std::isfinite(values[2 * index]) || !std::isfinite(values[2 * index + 1])) return REMAGX_NUMERICAL_ERROR;
    }
    std::copy(values, values + 18, output);
    return REMAGX_SUCCESS;
}
