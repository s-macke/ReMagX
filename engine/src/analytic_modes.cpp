#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <complex>

namespace {
using Complex = std::complex<double>;
bool finite(const double* values, int count) {
    if (!values) return false;
    for (int index = 0; index < count; ++index)
        if (!std::isfinite(values[index])) return false;
    return true;
}
// Legacy SetMatrixLine stores each supplied field vector as a column.
// Our mode assembly names the physical field rows; transpose those
// into the actual CMATRIX storage consumed by legacy stack operations.
void transpose_boundary(Complex* matrix) {
    for (int row = 0; row < 4; ++row)
        for (int column = row + 1; column < 4; ++column)
            std::swap(matrix[row * 4 + column], matrix[column * 4 + row]);
}
bool pack(const Complex* values, int count, double* output) {
    for (int index = 0; index < count; ++index) {
        output[2 * index] = values[index].real();
        output[2 * index + 1] = values[index].imag();
    }
    return finite(output, count * 2);
}
}

extern "C" int remagx_classify_tensor(const double* tensor, double epsilon, int* kind) {
    if (!finite(tensor, 18) || !std::isfinite(epsilon) || !kind) return REMAGX_INVALID_ARGUMENT;
    Complex entries[9];
    for (int index = 0; index < 9; ++index) entries[index] = {tensor[2 * index], tensor[2 * index + 1]};
    double maximum = 0.0;
    for (int row = 0; row < 3; ++row)
        for (int column = 0; column < 3; ++column)
            if (row != column) maximum = std::max(maximum, std::norm(entries[row * 3 + column]));
    int result = REMAGX_MATRIX_ANISOTROPIC;
    if (std::sqrt(maximum) < epsilon) {
        result = REMAGX_MATRIX_TETRAGONAL;
        maximum = 0.0;
        maximum = std::max(maximum, std::norm(entries[0] - entries[4]));
        maximum = std::max(maximum, std::norm(entries[0] - entries[8]));
        maximum = std::max(maximum, std::norm(entries[4] - entries[8]));
        if (std::sqrt(maximum) < epsilon) result = REMAGX_MATRIX_ISOTROPIC;
    }
    *kind = result;
    return REMAGX_SUCCESS;
}

extern "C" int remagx_analytic_modes(int kind, const double* tensor, const double* refractive_index,
                                     double angle, double wave_number, double thickness,
                                     double* roots, double* boundary, double* propagation) {
    if (!roots || !boundary || !propagation || !std::isfinite(angle) ||
        !std::isfinite(wave_number) || !std::isfinite(thickness) ||
        (kind != REMAGX_MATRIX_ISOTROPIC && kind != REMAGX_MATRIX_TETRAGONAL)) return REMAGX_INVALID_ARGUMENT;
    Complex modes[4], interface_matrix[16] = {}, propagation_matrix[16] = {};
    const Complex imaginary(0.0, 1.0);
    if (kind == REMAGX_MATRIX_ISOTROPIC) {
        if (!finite(refractive_index, 2)) return REMAGX_INVALID_ARGUMENT;
        const Complex index(refractive_index[0], refractive_index[1]);
        if (angle < 1e-4) angle = 1e-4;
        const Complex tangential = std::cos(angle);
        modes[0] = std::sqrt(index * index - tangential * tangential);
        const Complex normal = modes[0] / index;
        modes[1] = modes[0]; modes[2] = -modes[0]; modes[3] = -modes[0];
        const Complex forward = thickness != 0.0 ?
            std::exp(-imaginary * (wave_number * thickness * index * normal)) : Complex(1.0, 0.0);
        propagation_matrix[0] = propagation_matrix[5] = forward;
        propagation_matrix[10] = propagation_matrix[15] = 1.0 / forward;
        interface_matrix[0] = interface_matrix[2] = 1.0;
        interface_matrix[5] = normal; interface_matrix[7] = -normal;
        interface_matrix[9] = interface_matrix[11] = -index;
        interface_matrix[12] = normal * index; interface_matrix[14] = -normal * index;
    } else {
        if (!finite(tensor, 18)) return REMAGX_INVALID_ARGUMENT;
        const Complex xx(tensor[0], tensor[1]), yy(tensor[8], tensor[9]), zz(tensor[16], tensor[17]);
        const double tangential = std::cos(angle);
        modes[0] = +std::sqrt(xx - tangential * tangential);
        modes[1] = +std::sqrt(4.0 * yy * zz * (zz - tangential * tangential)) / (2.0 * zz);
        modes[2] = -std::sqrt(xx - tangential * tangential);
        modes[3] = -std::sqrt(4.0 * yy * zz * (zz - tangential * tangential)) / (2.0 * zz);
        const Complex electric_x[4] = {1.0, 0.0, 1.0, 0.0};
        const Complex electric_y[4] = {0.0, zz - tangential * tangential, 0.0, zz - tangential * tangential};
        const Complex electric_z[4] = {0.0, -tangential * modes[1], 0.0, -tangential * modes[3]};
        for (int mode = 0; mode < 4; ++mode) {
            interface_matrix[mode] = electric_x[mode];
            interface_matrix[4 + mode] = electric_y[mode];
            interface_matrix[8 + mode] = tangential * electric_z[mode] - electric_y[mode] * modes[mode];
            interface_matrix[12 + mode] = modes[mode] * electric_x[mode];
            propagation_matrix[mode * 5] = std::exp(-imaginary * wave_number * modes[mode] * thickness);
        }
    }
    transpose_boundary(interface_matrix);
    double packed_roots[8], packed_boundary[32], packed_propagation[32];
    if (!pack(modes, 4, packed_roots) || !pack(interface_matrix, 16, packed_boundary) ||
        !pack(propagation_matrix, 16, packed_propagation)) return REMAGX_NUMERICAL_ERROR;
    std::copy(packed_roots, packed_roots + 8, roots);
    std::copy(packed_boundary, packed_boundary + 32, boundary);
    std::copy(packed_propagation, packed_propagation + 32, propagation);
    return REMAGX_SUCCESS;
}

// SetMatrix/SetMatrixAnisotropic dispatch and normalized cofactor eigenvectors.
extern "C" int remagx_matrix_modes(int anisotropic, const double* tensor, const double* refractive_index,
                                   double epsilon, double angle, double wave_number, double thickness,
                                   double* roots, double* boundary, double* propagation) {
    if ((anisotropic != 0 && anisotropic != 1) || !roots || !boundary || !propagation ||
        !std::isfinite(epsilon) || !std::isfinite(angle) || !std::isfinite(wave_number) ||
        !std::isfinite(thickness)) return REMAGX_INVALID_ARGUMENT;
    if (!anisotropic) return remagx_analytic_modes(REMAGX_MATRIX_ISOTROPIC, tensor, refractive_index,
                                                 angle, wave_number, thickness, roots, boundary, propagation);
    int kind;
    int status = remagx_classify_tensor(tensor, epsilon, &kind);
    if (status != REMAGX_SUCCESS) return status;
    if (kind != REMAGX_MATRIX_ANISOTROPIC) {
        const Complex index = std::sqrt(Complex(tensor[0], tensor[1]));
        const double packed_index[2] = {index.real(), index.imag()};
        return remagx_analytic_modes(kind, tensor, packed_index, angle, wave_number, thickness,
                                    roots, boundary, propagation);
    }
    double packed_roots[8];
    status = remagx_maxwell_roots(tensor, angle, packed_roots);
    if (status != REMAGX_SUCCESS) return status;
    Complex entries[9], interface_matrix[16] = {}, propagation_matrix[16] = {};
    for (int entry = 0; entry < 9; ++entry) entries[entry] = {tensor[2 * entry], tensor[2 * entry + 1]};
    const double tangential = std::cos(angle);
    const Complex imaginary(0.0, 1.0);
    for (int mode = 0; mode < 4; ++mode) {
        const Complex root(packed_roots[2 * mode], packed_roots[2 * mode + 1]);
        Complex electric_x = -entries[1] * (entries[8] - tangential * tangential) +
                             entries[2] * (entries[7] + tangential * root);
        Complex electric_y = (entries[8] - tangential * tangential) *
                             (entries[0] - tangential * tangential - root * root) - entries[2] * entries[6];
        Complex electric_z = -(entries[0] - tangential * tangential - root * root) *
                             (entries[7] + tangential * root) + entries[6] * entries[1];
        double squared_length = 0.0;
        squared_length += electric_x.real() * electric_x.real();
        squared_length += electric_x.imag() * electric_x.imag();
        squared_length += electric_y.real() * electric_y.real();
        squared_length += electric_y.imag() * electric_y.imag();
        squared_length += electric_z.real() * electric_z.real();
        squared_length += electric_z.imag() * electric_z.imag();
        const double normalization = 1.0 / std::sqrt(squared_length);
        electric_x *= normalization; electric_y *= normalization; electric_z *= normalization;
        interface_matrix[mode] = electric_x;
        interface_matrix[4 + mode] = electric_y;
        interface_matrix[8 + mode] = tangential * electric_z - electric_y * root;
        interface_matrix[12 + mode] = root * electric_x;
        propagation_matrix[mode * 5] = std::exp(-imaginary * wave_number * root * thickness);
    }
    transpose_boundary(interface_matrix);
    double packed_boundary[32], packed_propagation[32];
    if (!pack(interface_matrix, 16, packed_boundary) || !pack(propagation_matrix, 16, packed_propagation))
        return REMAGX_NUMERICAL_ERROR;
    std::copy(packed_roots, packed_roots + 8, roots);
    std::copy(packed_boundary, packed_boundary + 32, boundary);
    std::copy(packed_propagation, packed_propagation + 32, propagation);
    return REMAGX_SUCCESS;
}
