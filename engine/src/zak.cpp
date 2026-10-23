#include "complex_arithmetic.hpp"
#include "remagx/core.h"
#include "matrix_algebra.hpp"
#include <limits>
#include <algorithm>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
using namespace remagx::matrix;
bool valid_stack(const RemagxLayer* layers, size_t layer_count) {
    if (!layers || layer_count < 2 || layer_count > std::numeric_limits<size_t>::max() / sizeof(RemagxLayer)) return false;
    for (size_t position = 0; position < layer_count; ++position) {
        const auto& layer = layers[position];
        for (double value : {layer.thickness, layer.roughness, layer.delta, layer.beta,
                             layer.delta_magnetic, layer.beta_magnetic, layer.gamma_degrees, layer.phi_degrees})
            if (!std::isfinite(value)) return false;
    }
    return true;
}
int modes(const RemagxLayer& layer, double angle, double wave_number, int magnetic_enabled,
          double thickness, Matrix& boundary, Matrix& propagation, Complex& root) {
    const Complex imaginary(0.0, 1.0);
    const Complex index = 1.0 - layer.delta + imaginary * layer.beta;
    const Complex magnetic = magnetic_enabled ? (-layer.delta_magnetic + imaginary * layer.beta_magnetic) * 2.0 : Complex(0.0);
    const double packed_index[2] = {index.real(), index.imag()};
    const double packed_magnetic[2] = {magnetic.real(), magnetic.imag()};
    double packed_root[2], packed_boundary[32], packed_propagation[32];
    const double degrees_per_radian = 180.0 / 3.141592653589793238462643383279502884;
    const int status = remagx_zak_modes(packed_index, packed_magnetic, angle,
        layer.gamma_degrees / degrees_per_radian, layer.phi_degrees / degrees_per_radian,
        wave_number, thickness, packed_root, packed_boundary, packed_propagation);
    if (status != REMAGX_SUCCESS) return status;
    root = {packed_root[0], packed_root[1]};
    for (int row = 0; row < 4; ++row) for (int column = 0; column < 4; ++column) {
        const int offset = 2 * (row * 4 + column);
        boundary.entries[row][column] = {packed_boundary[offset], packed_boundary[offset + 1]};
        if (thickness != 0.0)
            propagation.entries[row][column] = {packed_propagation[offset], packed_propagation[offset + 1]};
    }
    return REMAGX_SUCCESS;
}
void roughen(Matrix& matrix, double roughness, double wave_number, Complex previous, Complex current) {
    if (roughness == 0.0) return;
    const Complex sum_factor = remagx::reference_complex_exponential(-wave_number * wave_number * (previous + current) *
        (previous + current) * roughness * roughness / 2.0);
    const Complex difference_factor = remagx::reference_complex_exponential(-wave_number * wave_number * (previous - current) *
        (previous - current) * roughness * roughness / 2.0);
    for (int row = 0; row < 2; ++row) for (int column = 0; column < 2; ++column) {
        matrix.entries[row][column] *= difference_factor;
        matrix.entries[row + 2][column] *= sum_factor;
        matrix.entries[row][column + 2] *= sum_factor;
        matrix.entries[row + 2][column + 2] *= difference_factor;
    }
}
}

extern "C" int remagx_zak(const RemagxLayer* layers, size_t layer_count, double angle,
                           double wave_number, int magnetic_enabled, const RemagxBeam* beam1,
                           const RemagxBeam* beam2, int analyzer, RemagxReflectivity* output) {
    using namespace remagx::matrix;
    if (!valid_stack(layers, layer_count) || !output || !std::isfinite(angle) || !std::isfinite(wave_number) ||
        (magnetic_enabled != 0 && magnetic_enabled != 1) || !valid_beam(beam1) || !valid_beam(beam2) ||
        analyzer < REMAGX_BOTH || analyzer > REMAGX_PI) return REMAGX_INVALID_ARGUMENT;
    Matrix reflection, previous_boundary, propagation;
    Complex previous_root;
    for (int diagonal = 0; diagonal < 4; ++diagonal) reflection.entries[diagonal][diagonal] = 1.0;
    int status = modes(layers[layer_count - 1], angle, wave_number, magnetic_enabled, 0.0,
                       previous_boundary, propagation, previous_root);
    if (status != REMAGX_SUCCESS) return status;
    if (!invert(previous_boundary)) return REMAGX_NUMERICAL_ERROR;
    for (size_t position = layer_count - 1; position-- > 0;) {
        Matrix boundary;
        Complex root;
        status = modes(layers[position], angle, wave_number, magnetic_enabled,
            position == 0 ? 0.0 : layers[position].thickness, boundary, propagation, root);
        if (status != REMAGX_SUCCESS) return status;
        Matrix interface_matrix = legacy_product(previous_boundary, boundary);
        roughen(interface_matrix, layers[position].roughness, wave_number, previous_root, root);
        reflection = legacy_product(reflection, interface_matrix);
        if (position != 0) {
            reflection = legacy_product(reflection, propagation);
            if (!invert(boundary)) return REMAGX_NUMERICAL_ERROR;
            previous_boundary = boundary;
            previous_root = root;
        }
        if (!finite_matrix(reflection)) return REMAGX_NUMERICAL_ERROR;
    }
    const RemagxReflectivity result = {intensity(reflection, *beam1, analyzer, false), intensity(reflection, *beam2, analyzer, false)};
    if (!std::isfinite(result.beam1) || !std::isfinite(result.beam2)) return REMAGX_NUMERICAL_ERROR;
    *output = result;
    return REMAGX_SUCCESS;
}

extern "C" int remagx_zak_qz(const RemagxLayer* layers, size_t layer_count,
                                   const double* qz, size_t point_count, double energy_ev, int magnetic_enabled,
                                   const RemagxBeam* beam1, const RemagxBeam* beam2,
                                   int analyzer, int scan_mode, RemagxReflectivity* output) {
    if (!valid_stack(layers, layer_count) || !qz || !point_count || !output ||
        !std::isfinite(energy_ev) || energy_ev <= 0.0 || (magnetic_enabled != 0 && magnetic_enabled != 1) || !valid_beam(beam1) ||
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
            const int status = remagx_zak(layers, layer_count, remagx::reference_inverse_sine(ratio), wave_number, magnetic_enabled,
                beam1, scan_mode == REMAGX_DICHROIC ? beam2 : beam1, analyzer, &results[index]);
            if (status != REMAGX_SUCCESS) return status;
            if (scan_mode == REMAGX_MONOCHROMATIC) results[index].beam2 = 0.0;
        }
        std::copy(results.begin(), results.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
