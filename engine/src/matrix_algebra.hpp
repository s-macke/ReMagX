#pragma once
#include "remagx/core.h"
#include <cmath>
#include <complex>

namespace remagx::matrix {
using Complex = std::complex<double>;
struct Matrix { Complex entries[4][4] = {}; };
inline bool finite(Complex value) { return std::isfinite(value.real()) && std::isfinite(value.imag()); }
inline bool finite_matrix(const Matrix& matrix) {
    for (const auto& row : matrix.entries) for (const auto value : row) if (!finite(value)) return false;
    return true;
}
// Preserve the expanded CMATRIX determinant's arithmetic order.
inline Complex determinant(const Matrix& matrix) {
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
inline bool invert(Matrix& matrix) {
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
inline Matrix legacy_product(const Matrix& left, const Matrix& right) {
    Matrix result;
    for (int row = 0; row < 4; ++row) for (int column = 0; column < 4; ++column)
        for (int inner = 0; inner < 4; ++inner)
            result.entries[row][column] += left.entries[inner][column] * right.entries[row][inner];
    return result;
}
inline bool valid_beam(const RemagxBeam* beam) {
    return beam && std::isfinite(beam->sigma_real) && std::isfinite(beam->sigma_imaginary) &&
        std::isfinite(beam->pi_real) && std::isfinite(beam->pi_imaginary);
}
inline double intensity(const Matrix& reflection, const RemagxBeam& beam, int analyzer, bool clamp_divisor = true) {
    const auto& entries = reflection.entries;
    Complex divisor = -entries[0][1]*entries[1][0] + entries[1][1]*entries[0][0];
    if (clamp_divisor && std::abs(divisor) < 1e-10) divisor = 1e-10;
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
