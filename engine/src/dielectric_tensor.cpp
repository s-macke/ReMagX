#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <complex>

// MaterialConstantsHelper.cpp FillEpsilonTensor. This is scalar construction;
// imported .e tensors must retain their supplied entries instead.
extern "C" int remagx_dielectric_tensor(const RemagxLayer* layer, int tensor,
                                        int magnetization_enabled, double* output, int* anisotropic) {
    if (!layer || !output || !anisotropic || (tensor != REMAGX_ISOTROPIC && tensor != REMAGX_TETRAGONAL) ||
        (magnetization_enabled != 0 && magnetization_enabled != 1) ||
        !std::isfinite(layer->delta) || !std::isfinite(layer->beta) ||
        !std::isfinite(layer->delta_magnetic) || !std::isfinite(layer->beta_magnetic) ||
        !std::isfinite(layer->gamma_degrees) || !std::isfinite(layer->phi_degrees)) return REMAGX_INVALID_ARGUMENT;
    using Complex = std::complex<double>;
    constexpr double pi = 3.141592653589793238462643383279502884;
    const Complex index(1.0 - layer->delta, layer->beta);
    Complex entries[9] = {};
    entries[0] = entries[4] = entries[8] = index * index;
    const int kind = tensor == REMAGX_TETRAGONAL || magnetization_enabled ? 1 : 0;
    if (tensor == REMAGX_TETRAGONAL) {
        const Complex extraordinary(1.0 - layer->delta_magnetic, layer->beta_magnetic);
        entries[8] = extraordinary * extraordinary;
    } else if (magnetization_enabled) {
        const double gamma = layer->gamma_degrees / 180.0 * pi;
        const double phi = layer->phi_degrees / 180.0 * pi;
        const Complex magnetic(layer->delta_magnetic, -layer->beta_magnetic);
        const Complex factor = index * index * magnetic * 2.0 * Complex(0.0, 1.0);
        entries[2] = std::sin(gamma) * std::sin(phi) * factor;
        entries[6] = -std::sin(gamma) * std::sin(phi) * factor;
        entries[5] = std::cos(gamma) * std::sin(phi) * factor;
        entries[7] = -std::cos(gamma) * std::sin(phi) * factor;
        entries[1] = -std::cos(phi) * factor;
        entries[3] = std::cos(phi) * factor;
    }
    double values[18];
    for (int entry = 0; entry < 9; ++entry) {
        values[entry * 2] = entries[entry].real();
        values[entry * 2 + 1] = entries[entry].imag();
        if (!std::isfinite(values[entry * 2]) || !std::isfinite(values[entry * 2 + 1])) return REMAGX_NUMERICAL_ERROR;
    }
    std::copy(values, values + 18, output);
    *anisotropic = kind;
    return REMAGX_SUCCESS;
}
