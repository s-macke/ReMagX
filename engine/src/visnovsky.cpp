#include "remagx/core.h"
#include <cmath>
#include <complex>
#include <limits>

namespace {
using Complex = std::complex<double>;
struct Matrix { Complex entries[4][4] = {}; };
bool finite(Complex value) { return std::isfinite(value.real()) && std::isfinite(value.imag()); }
bool finite_matrix(const Matrix& matrix) {
    for (const auto& row : matrix.entries) for (const auto value : row) if (!finite(value)) return false;
    return true;
}
// Preserve the expanded CMATRIX determinant's arithmetic order.
Complex determinant(const Matrix& matrix) {
    const auto& entries = matrix.entries;
    return entries[0][0]*entries[1][1]*entries[2][2]*entries[3][3]-
        entries[0][0]*entries[1][1]*entries[3][2]*entries[2][3]-
        entries[0][0]*entries[1][2]*entries[2][1]*entries[3][3]+
        entries[0][0]*entries[1][2]*entries[3][1]*entries[2][3]+
        entries[0][0]*entries[1][3]*entries[2][1]*entries[3][2]-
        entries[0][0]*entries[1][3]*entries[3][1]*entries[2][2]-
        entries[0][1]*entries[1][0]*entries[2][2]*entries[3][3]+
        entries[0][1]*entries[1][0]*entries[3][2]*entries[2][3]+
        entries[0][1]*entries[1][2]*entries[2][0]*entries[3][3]-
        entries[0][1]*entries[1][2]*entries[3][0]*entries[2][3]-
        entries[0][1]*entries[1][3]*entries[2][0]*entries[3][2]+
        entries[0][1]*entries[1][3]*entries[3][0]*entries[2][2]+
        entries[0][2]*entries[1][0]*entries[2][1]*entries[3][3]-
        entries[0][2]*entries[1][0]*entries[3][1]*entries[2][3]-
        entries[0][2]*entries[1][1]*entries[2][0]*entries[3][3]+
        entries[0][2]*entries[1][1]*entries[3][0]*entries[2][3]+
        entries[0][2]*entries[1][3]*entries[2][0]*entries[3][1]-
        entries[0][2]*entries[1][3]*entries[3][0]*entries[2][1]-
        entries[0][3]*entries[1][0]*entries[2][1]*entries[3][2]+
        entries[0][3]*entries[1][0]*entries[3][1]*entries[2][2]+
        entries[0][3]*entries[1][1]*entries[2][0]*entries[3][2]-
        entries[0][3]*entries[1][1]*entries[3][0]*entries[2][2]-
        entries[0][3]*entries[1][2]*entries[2][0]*entries[3][1]+
        entries[0][3]*entries[1][2]*entries[3][0]*entries[2][1];
}
// Adjugate inverse with the original six-term minor order and sign placement.
// This is the elementary 4x4 cofactor expression, not a library/NR inverse.
bool invert(Matrix& matrix) {
    const Complex divisor = determinant(matrix);
    Matrix result;
    for (int row = 0; row < 4; ++row) for (int column = 0; column < 4; ++column) {
        Complex minor[3][3];
        int target_row = 0;
        for (int source_row = 0; source_row < 4; ++source_row) {
            if (source_row == row) continue;
            int target_column = 0;
            for (int source_column = 0; source_column < 4; ++source_column) {
                if (source_column != column) minor[target_row][target_column++] = matrix.entries[source_row][source_column];
            }
            ++target_row;
        }
        Complex cofactor;
        if ((row + column) % 2 == 0) {
            cofactor = minor[0][0]*minor[1][1]*minor[2][2] - minor[0][0]*minor[2][1]*minor[1][2]
                     - minor[0][1]*minor[1][0]*minor[2][2] + minor[0][1]*minor[2][0]*minor[1][2]
                     + minor[0][2]*minor[1][0]*minor[2][1] - minor[0][2]*minor[2][0]*minor[1][1];
        } else {
            cofactor = -minor[0][0]*minor[1][1]*minor[2][2] + minor[0][0]*minor[2][1]*minor[1][2]
                     + minor[0][1]*minor[1][0]*minor[2][2] - minor[0][1]*minor[2][0]*minor[1][2]
                     - minor[0][2]*minor[1][0]*minor[2][1] + minor[0][2]*minor[2][0]*minor[1][1];
        }
        result.entries[column][row] = cofactor / divisor;
    }
    if (!finite_matrix(result)) return false;
    matrix = result;
    return true;
}
// Legacy MultiplyMatrix(left, right) computes right*left in CMATRIX storage.
Matrix legacy_product(const Matrix& left, const Matrix& right) {
    Matrix result;
    for (int row = 0; row < 4; ++row) for (int column = 0; column < 4; ++column)
        for (int inner = 0; inner < 4; ++inner)
            result.entries[row][column] += left.entries[inner][column] * right.entries[row][inner];
    return result;
}
int modes(const RemagxMatrixLayer& layer, double angle, double wave_number, double epsilon,
          double thickness, Matrix& boundary, Matrix& propagation, Complex* roots) {
    const double index[2] = {layer.index_real, layer.index_imaginary};
    double packed_roots[8], packed_boundary[32], packed_propagation[32];
    const int status = remagx_matrix_modes(layer.anisotropic, layer.dielectric, index, epsilon,
        angle, wave_number, thickness, packed_roots, packed_boundary, packed_propagation);
    if (status != REMAGX_SUCCESS) return status;
    for (int mode = 0; mode < 4; ++mode) roots[mode] = {packed_roots[2*mode], packed_roots[2*mode+1]};
    for (int row = 0; row < 4; ++row) for (int column = 0; column < 4; ++column) {
        const int offset = 2*(row*4+column);
        boundary.entries[row][column] = {packed_boundary[offset], packed_boundary[offset+1]};
        propagation.entries[row][column] = {packed_propagation[offset], packed_propagation[offset+1]};
    }
    return REMAGX_SUCCESS;
}
void roughen(Matrix& interface_matrix, double roughness, double wave_number,
             const Complex* previous_roots, const Complex* roots) {
    if (roughness == 0.0) return;
    for (int row = 0; row < 4; ++row) for (int column = 0; column < 4; ++column) {
        const Complex difference = previous_roots[column] - roots[row];
        interface_matrix.entries[row][column] *= std::exp(-wave_number*wave_number*difference*difference*roughness*roughness/2.0);
    }
}
bool valid_beam(const RemagxBeam* beam) {
    return beam && std::isfinite(beam->sigma_real) && std::isfinite(beam->sigma_imaginary) &&
        std::isfinite(beam->pi_real) && std::isfinite(beam->pi_imaginary);
}
double intensity(const Matrix& reflection, const RemagxBeam& beam, int analyzer) {
    const auto& entries = reflection.entries;
    Complex divisor = -entries[0][1]*entries[1][0] + entries[1][1]*entries[0][0];
    if (std::abs(divisor) < 1e-10) divisor = 1e-10;
    const Complex sigma(beam.sigma_real, beam.sigma_imaginary), pi(beam.pi_real, beam.pi_imaginary);
    const Complex reflected_sigma = (entries[0][0]*entries[1][2]*pi - entries[1][2]*entries[0][1]*sigma
        - entries[0][2]*entries[1][0]*pi + entries[1][1]*entries[0][2]*sigma)/divisor;
    const Complex reflected_pi = (entries[0][0]*entries[1][3]*pi - entries[1][3]*entries[0][1]*sigma
        - entries[0][3]*entries[1][0]*pi + entries[1][1]*entries[0][3]*sigma)/divisor;
    if (analyzer == REMAGX_SIGMA) return (reflected_sigma * std::conj(reflected_sigma)).real();
    if (analyzer == REMAGX_PI) return (reflected_pi * std::conj(reflected_pi)).real();
    return (reflected_sigma * std::conj(reflected_sigma)).real() + (reflected_pi * std::conj(reflected_pi)).real();
}
}

extern "C" int remagx_visnovsky(const RemagxMatrixLayer* layers, size_t layer_count,
                                double angle, double wave_number, double epsilon,
                                const RemagxBeam* beam1, const RemagxBeam* beam2,
                                int analyzer, RemagxReflectivity* output) {
    if (!layers || layer_count < 2 || layer_count > std::numeric_limits<size_t>::max()/sizeof(RemagxMatrixLayer) ||
        !output || !std::isfinite(angle) || !std::isfinite(wave_number) || !std::isfinite(epsilon) ||
        !valid_beam(beam1) || !valid_beam(beam2) || analyzer < REMAGX_BOTH || analyzer > REMAGX_PI)
        return REMAGX_INVALID_ARGUMENT;
    for (size_t position = 0; position < layer_count; ++position) {
        const auto& layer = layers[position];
        if (!std::isfinite(layer.thickness) || !std::isfinite(layer.roughness) ||
            !std::isfinite(layer.index_real) || !std::isfinite(layer.index_imaginary) ||
            (layer.anisotropic != 0 && layer.anisotropic != 1)) return REMAGX_INVALID_ARGUMENT;
        for (double entry : layer.dielectric) if (!std::isfinite(entry)) return REMAGX_INVALID_ARGUMENT;
    }
    Matrix reflection, previous_boundary, propagation;
    Complex previous_roots[4];
    for (int diagonal = 0; diagonal < 4; ++diagonal) reflection.entries[diagonal][diagonal] = 1.0;
    int status = modes(layers[layer_count-1], angle, wave_number, epsilon, 0.0,
                       previous_boundary, propagation, previous_roots);
    if (status != REMAGX_SUCCESS) return status;
    if (!invert(previous_boundary)) return REMAGX_NUMERICAL_ERROR;
    for (size_t position = layer_count-1; position-- > 0;) {
        Matrix boundary;
        Complex roots[4];
        status = modes(layers[position], angle, wave_number, epsilon,
                       position == 0 ? 0.0 : layers[position].thickness, boundary, propagation, roots);
        if (status != REMAGX_SUCCESS) return status;
        Matrix interface_matrix = legacy_product(previous_boundary, boundary);
        roughen(interface_matrix, layers[position].roughness, wave_number, previous_roots, roots);
        reflection = legacy_product(reflection, interface_matrix);
        if (position != 0) {
            reflection = legacy_product(reflection, propagation);
            if (!invert(boundary)) return REMAGX_NUMERICAL_ERROR;
            previous_boundary = boundary;
            for (int mode = 0; mode < 4; ++mode) previous_roots[mode] = roots[mode];
        }
        if (!finite_matrix(reflection)) return REMAGX_NUMERICAL_ERROR;
    }
    const RemagxReflectivity result = {intensity(reflection, *beam1, analyzer), intensity(reflection, *beam2, analyzer)};
    if (!std::isfinite(result.beam1) || !std::isfinite(result.beam2)) return REMAGX_NUMERICAL_ERROR;
    *output = result;
    return REMAGX_SUCCESS;
}
