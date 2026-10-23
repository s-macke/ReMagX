#include "complex_arithmetic.hpp"
#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <complex>

extern "C" int remagx_zak_modes(const double* refractive_index, const double* magnetic_constant,
                                double angle, double gamma, double phi, double wave_number,
                                double thickness, double* root, double* boundary, double* propagation) {
    if (!refractive_index || !magnetic_constant || !root || !boundary || !propagation)
        return REMAGX_INVALID_ARGUMENT;
    for (double value : {refractive_index[0], refractive_index[1], magnetic_constant[0], magnetic_constant[1],
                         angle, gamma, phi, wave_number, thickness})
        if (!std::isfinite(value)) return REMAGX_INVALID_ARGUMENT;
    using Complex = std::complex<double>;
    const Complex index(refractive_index[0], refractive_index[1]);
    const Complex magnetic(magnetic_constant[0], magnetic_constant[1]), imaginary(0.0, 1.0);
    if (angle < 1e-4) angle = 1e-4;
    const Complex tangential = remagx::reference_cosine(angle);
    const Complex normal_root = remagx::reference_complex_square_root(index * index - tangential * tangential);
    const Complex tangent_direction = remagx::reference_complex_divide(tangential, index), normal_direction = remagx::reference_complex_divide(normal_root, index);
    const Complex forward_direction = remagx::reference_cosine(phi) * normal_direction + tangent_direction * remagx::reference_sine(gamma) * remagx::reference_sine(phi);
    const Complex backward_direction = -remagx::reference_cosine(phi) * normal_direction + tangent_direction * remagx::reference_sine(gamma) * remagx::reference_sine(phi);
    const Complex forward_rotation = remagx::reference_complex_divide(0.5 * wave_number * index * thickness * magnetic, normal_direction) * forward_direction;
    const Complex backward_rotation = remagx::reference_complex_divide(0.5 * wave_number * index * thickness * magnetic, normal_direction) * backward_direction;
    Complex interface_matrix[16] = {}, propagation_matrix[16] = {};
    // SetMatrixLine in the original writes a column, not a row.
    auto column = [](Complex* matrix, int column_index, Complex first, Complex second, Complex third, Complex fourth) {
        matrix[column_index] = first; matrix[4 + column_index] = second;
        matrix[8 + column_index] = third; matrix[12 + column_index] = fourth;
    };
    if (thickness != 0.0) {
        const Complex forward = remagx::reference_complex_exponential(-imaginary * wave_number * index * normal_direction * thickness);
        column(propagation_matrix, 0, forward, forward * forward_rotation, 0.0, 0.0);
        column(propagation_matrix, 1, -forward * forward_rotation, forward, 0.0, 0.0);
        column(propagation_matrix, 2, 0.0, 0.0, remagx::reference_complex_divide(1.0, forward), remagx::reference_complex_divide(-1.0, forward) * backward_rotation);
        column(propagation_matrix, 3, 0.0, 0.0, remagx::reference_complex_divide(1.0, forward) * backward_rotation, remagx::reference_complex_divide(1.0, forward));
    }
    column(interface_matrix, 0, 1.0, 0.0, 1.0, 0.0);
    column(interface_matrix, 1,
        remagx::reference_complex_divide(imaginary / 2.0 * tangent_direction, normal_direction) * magnetic * (tangent_direction * forward_direction - 2.0 * remagx::reference_sine(phi) * remagx::reference_sine(gamma)),
        normal_direction + magnetic * imaginary * tangent_direction * remagx::reference_sine(phi) * remagx::reference_cosine(gamma),
        -remagx::reference_complex_divide(imaginary / 2.0 * tangent_direction, normal_direction) * magnetic * (tangent_direction * backward_direction - 2.0 * remagx::reference_sine(phi) * remagx::reference_sine(gamma)),
        -normal_direction + magnetic * imaginary * tangent_direction * remagx::reference_sine(phi) * remagx::reference_cosine(gamma));
    column(interface_matrix, 2, imaginary * index * magnetic * forward_direction / 2.0, -index,
        imaginary * index * magnetic * backward_direction / 2.0, -index);
    column(interface_matrix, 3, normal_direction * index,
        remagx::reference_complex_divide(imaginary * index * forward_direction * magnetic / 2.0, normal_direction),
        -normal_direction * index, -remagx::reference_complex_divide(imaginary * index * backward_direction * magnetic / 2.0, normal_direction));
    double packed_boundary[32], packed_propagation[32];
    auto pack = [](const Complex* source, double* target) {
        for (int entry = 0; entry < 16; ++entry) {
            if (!std::isfinite(source[entry].real()) || !std::isfinite(source[entry].imag())) return false;
            target[2 * entry] = source[entry].real(); target[2 * entry + 1] = source[entry].imag();
        }
        return true;
    };
    if (!std::isfinite(normal_root.real()) || !std::isfinite(normal_root.imag()) ||
        !pack(interface_matrix, packed_boundary) ||
        (thickness != 0.0 && !pack(propagation_matrix, packed_propagation))) return REMAGX_NUMERICAL_ERROR;
    root[0] = normal_root.real(); root[1] = normal_root.imag();
    std::copy(packed_boundary, packed_boundary + 32, boundary);
    // Legacy does not assign U when d == 0, including internal layers.
    if (thickness != 0.0) std::copy(packed_propagation, packed_propagation + 32, propagation);
    return REMAGX_SUCCESS;
}
