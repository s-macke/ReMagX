#include "remagx/core.h"
#include "matrix_algebra.hpp"
#include <limits>

namespace {
using namespace remagx::matrix;
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
    const Complex sum_factor = std::exp(-wave_number * wave_number * (previous + current) *
        (previous + current) * roughness * roughness / 2.0);
    const Complex difference_factor = std::exp(-wave_number * wave_number * (previous - current) *
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
    if (!layers || layer_count < 2 || layer_count > std::numeric_limits<size_t>::max() / sizeof(RemagxLayer) ||
        !output || !std::isfinite(angle) || !std::isfinite(wave_number) ||
        (magnetic_enabled != 0 && magnetic_enabled != 1) || !valid_beam(beam1) || !valid_beam(beam2) ||
        analyzer < REMAGX_BOTH || analyzer > REMAGX_PI) return REMAGX_INVALID_ARGUMENT;
    for (size_t position = 0; position < layer_count; ++position) {
        const auto& layer = layers[position];
        for (double value : {layer.thickness, layer.roughness, layer.delta, layer.beta,
                             layer.delta_magnetic, layer.beta_magnetic, layer.gamma_degrees, layer.phi_degrees})
            if (!std::isfinite(value)) return REMAGX_INVALID_ARGUMENT;
    }
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
