#include "complex_arithmetic.hpp"
#include "remagx/core.h"
#include "matrix_algebra.hpp"
#include <cmath>
#include <complex>
#include <limits>
#include <algorithm>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
using namespace remagx::matrix;
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
bool valid_stack(const RemagxMatrixLayer* layers, size_t layer_count) {
    if (!layers || layer_count < 2 || layer_count > std::numeric_limits<size_t>::max()/sizeof(RemagxMatrixLayer)) return false;
    for (size_t position = 0; position < layer_count; ++position) {
        const auto& layer = layers[position];
        if (!std::isfinite(layer.thickness) || !std::isfinite(layer.roughness) ||
            !std::isfinite(layer.index_real) || !std::isfinite(layer.index_imaginary) ||
            (layer.anisotropic != 0 && layer.anisotropic != 1)) return false;
        for (double entry : layer.dielectric) if (!std::isfinite(entry)) return false;
    }
    return true;
}

}

extern "C" int remagx_visnovsky(const RemagxMatrixLayer* layers, size_t layer_count,
                                double angle, double wave_number, double epsilon,
                                const RemagxBeam* beam1, const RemagxBeam* beam2,
                                int analyzer, RemagxReflectivity* output) {
    if (!valid_stack(layers, layer_count) || !output || !std::isfinite(angle) || !std::isfinite(wave_number) || !std::isfinite(epsilon) ||
        !valid_beam(beam1) || !valid_beam(beam2) || analyzer < REMAGX_BOTH || analyzer > REMAGX_PI)
        return REMAGX_INVALID_ARGUMENT;
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

extern "C" int remagx_visnovsky_qz(const RemagxMatrixLayer* layers, size_t layer_count,
                                   const double* qz, size_t point_count, double energy_ev, double epsilon,
                                   const RemagxBeam* beam1, const RemagxBeam* beam2,
                                   int analyzer, int scan_mode, RemagxReflectivity* output) {
    if (!valid_stack(layers, layer_count) || !qz || !point_count || !output ||
        !std::isfinite(energy_ev) || energy_ev <= 0.0 || !std::isfinite(epsilon) || !valid_beam(beam1) ||
        analyzer < REMAGX_BOTH || analyzer > REMAGX_PI ||
        (scan_mode != REMAGX_MONOCHROMATIC && scan_mode != REMAGX_DICHROIC) ||
        (scan_mode == REMAGX_DICHROIC && !valid_beam(beam2))) return REMAGX_INVALID_ARGUMENT;
    for (size_t index = 0; index < point_count; ++index) if (!std::isfinite(qz[index])) return REMAGX_INVALID_ARGUMENT;
    const double wave_number = 2.0 * 3.141592653589793238462643383279502884 / (12398.326 / energy_ev);
    if (!std::isfinite(wave_number) || wave_number <= 0.0 || !std::isfinite(2.0 * wave_number))
        return REMAGX_NUMERICAL_ERROR;
    try {
        std::vector<RemagxReflectivity> results(point_count, {0.0, 0.0});
        for (size_t index = 0; index < point_count; ++index) {
            const double ratio = qz[index] / (2.0 * wave_number);
            if ((scan_mode == REMAGX_MONOCHROMATIC && std::abs(ratio) >= 1.0) ||
                (scan_mode == REMAGX_DICHROIC && ratio > 1.0)) return REMAGX_QZ_ERROR;
            if (ratio < 0.0) continue;
            const int status = remagx_visnovsky(layers, layer_count, remagx::reference_inverse_sine(ratio), wave_number, epsilon,
                beam1, scan_mode == REMAGX_DICHROIC ? beam2 : beam1, analyzer, &results[index]);
            if (status != REMAGX_SUCCESS) return status;
            if (scan_mode == REMAGX_MONOCHROMATIC) results[index].beam2 = 0.0;
        }
        std::copy(results.begin(), results.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
