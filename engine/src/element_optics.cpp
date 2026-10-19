#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <complex>

// RechenHilfe.h Element2oc, after the caller has sampled each element density.
// Keep scalar and matrix accumulation orders distinct, including the scalar sqrt.
extern "C" int remagx_element_optics(const double* elements, size_t element_count,
                                      double factor, const double* scattering_tensors,
                                      double* optical_constants, double* dielectric_tensor) {
    if (!optical_constants || (element_count && !elements) || !std::isfinite(factor) ||
        (element_count && dielectric_tensor && !scattering_tensors)) return REMAGX_INVALID_ARGUMENT;
    using Complex = std::complex<double>;
    double scalar[4] = {};
    Complex entries[9] = {};
    entries[0] = entries[4] = entries[8] = Complex(1.0, 0.0);
    for (size_t element = 0; element < element_count; ++element) {
        const double* row = elements + element * 5;
        for (int column = 0; column < 5; ++column) {
            if (!std::isfinite(row[column])) return REMAGX_INVALID_ARGUMENT;
        }
        const double density = row[0];
        scalar[0] = scalar[0] + row[1] * density * 2.0 * factor;
        scalar[1] = scalar[1] + row[2] * density * 2.0 * factor;
        scalar[2] = scalar[2] + row[3] * density * factor;
        scalar[3] = scalar[3] + row[4] * density * factor;
        if (dielectric_tensor) {
            const double* tensor = scattering_tensors + element * 18;
            for (int entry = 0; entry < 9; ++entry) {
                if (!std::isfinite(tensor[2 * entry]) || !std::isfinite(tensor[2 * entry + 1])) return REMAGX_INVALID_ARGUMENT;
                entries[entry] += Complex(-tensor[2 * entry], tensor[2 * entry + 1]) * 2.0 * density * factor;
            }
        }
    }
    for (double value : scalar) if (!std::isfinite(value)) return REMAGX_NUMERICAL_ERROR;
    const Complex index = std::sqrt(Complex(1.0 - scalar[0], scalar[1]));
    scalar[0] = 1.0 - index.real();
    scalar[1] = index.imag();
    for (double value : scalar) if (!std::isfinite(value)) return REMAGX_NUMERICAL_ERROR;
    double tensor_values[18];
    if (dielectric_tensor) {
        for (int entry = 0; entry < 9; ++entry) {
            tensor_values[2 * entry] = entries[entry].real();
            tensor_values[2 * entry + 1] = entries[entry].imag();
            if (!std::isfinite(tensor_values[2 * entry]) || !std::isfinite(tensor_values[2 * entry + 1])) return REMAGX_NUMERICAL_ERROR;
        }
    }
    std::copy(scalar, scalar + 4, optical_constants);
    if (dielectric_tensor) std::copy(tensor_values, tensor_values + 18, dielectric_tensor);
    return REMAGX_SUCCESS;
}
