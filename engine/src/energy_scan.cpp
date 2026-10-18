#include "remagx/core.h"
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
bool valid_beam(const RemagxBeam* beam) {
    return beam && std::isfinite(beam->sigma_real) && std::isfinite(beam->sigma_imaginary) &&
        std::isfinite(beam->pi_real) && std::isfinite(beam->pi_imaginary);
}
}

namespace {
template<class Layer, class Evaluate>
int prepared_energy_scan(const Layer* layers, size_t layer_count,
                      const double* energies, const double* qz, const int* enabled, size_t point_count,
                      const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int analyzer, int scan_mode, double angular_width, double energy_width,
                      const RemagxEnergyPoint* settings, RemagxReflectivity* output, Evaluate evaluate) {
    if (!layers || layer_count < 2 || !energies || !qz || !point_count || !output ||
        !valid_beam(beam1) || (scan_mode == REMAGX_DICHROIC && !valid_beam(beam2)) ||
        (scan_mode != REMAGX_MONOCHROMATIC && scan_mode != REMAGX_DICHROIC) ||
        analyzer < REMAGX_BOTH || analyzer > REMAGX_PI ||
        !std::isfinite(angular_width) || angular_width < 0.0 ||
        !std::isfinite(energy_width) || energy_width < 0.0) return REMAGX_INVALID_ARGUMENT;
    if (point_count > std::numeric_limits<size_t>::max() / sizeof(Layer) / layer_count)
        return REMAGX_ALLOCATION_ERROR;
    for (size_t index = 0; index < point_count; ++index)
        if (!std::isfinite(energies[index]) || energies[index] <= 0.0 || !std::isfinite(qz[index]) ||
            (enabled && enabled[index] != 0 && enabled[index] != 1) ||
            (settings && (!std::isfinite(settings[index].calculation_energy) || settings[index].calculation_energy <= 0.0 ||
                !std::isfinite(settings[index].angular_width) || settings[index].angular_width < 0.0 ||
                !std::isfinite(settings[index].epsilon)))) return REMAGX_INVALID_ARGUMENT;
    try {
        // CalcEScan / CalcDicEScan leave these values in place when Filldb fails
        // its energy-range check; skipped points still participate in convolution.
        std::vector<RemagxReflectivity> raw(point_count,
            {1.0, scan_mode == REMAGX_DICHROIC ? 1.0 : 0.0});
        for (size_t index = 0; index < point_count; ++index) {
            if (enabled && !enabled[index]) continue;
            const double energy = settings ? settings[index].calculation_energy : energies[index];
            const double width = settings ? settings[index].angular_width : angular_width;
            const int status = evaluate(layers + index * layer_count, qz + index, energy, width, index, &raw[index]);
            if (status != REMAGX_SUCCESS) return status;
        }
        // This API commits its output only after convolution also succeeds.
        return remagx_energy_resolution(energies, raw.data(), point_count, energy_width, output);
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
}

extern "C" int remagx_parratt_energy_scan(const RemagxLayer* layers, size_t layer_count,
                      const double* energies, const double* qz, const int* enabled, size_t point_count,
                      const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int tensor, int analyzer, int magnetization_enabled, int scan_mode,
                      double angular_width, double energy_width, RemagxReflectivity* output) {
    return remagx_parratt_energy_scan_points(layers, layer_count, energies, qz, enabled, point_count, beam1, beam2, tensor, analyzer, magnetization_enabled, scan_mode, angular_width, energy_width, nullptr, output);
}

extern "C" int remagx_parratt_energy_scan_points(const RemagxLayer* layers, size_t layer_count,
                      const double* energies, const double* qz, const int* enabled, size_t point_count,
                      const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int tensor, int analyzer, int magnetization_enabled, int scan_mode,
                      double angular_width, double energy_width, const RemagxEnergyPoint* settings, RemagxReflectivity* output) {
    if ((tensor != REMAGX_ISOTROPIC && tensor != REMAGX_TETRAGONAL) ||
        (magnetization_enabled != 0 && magnetization_enabled != 1)) return REMAGX_INVALID_ARGUMENT;
    return prepared_energy_scan(layers, layer_count, energies, qz, enabled, point_count, beam1, beam2,
        analyzer, scan_mode, angular_width, energy_width, settings, output,
        [&](const RemagxLayer* stack, const double* coordinate, double energy, double width, size_t, RemagxReflectivity* result) {
            return remagx_parratt_qz_resolution(stack, layer_count, coordinate, 1, energy, beam1, beam2,
                tensor, analyzer, magnetization_enabled, scan_mode, width, 0, result);
        });
}

extern "C" int remagx_visnovsky_energy_scan(const RemagxMatrixLayer* layers, size_t layer_count,
                      const double* energies, const double* qz, const int* enabled, size_t point_count,
                      double epsilon, const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int analyzer, int scan_mode, double angular_width, double energy_width,
                      RemagxReflectivity* output) {
    return remagx_visnovsky_energy_scan_points(layers, layer_count, energies, qz, enabled, point_count, epsilon, beam1, beam2, analyzer, scan_mode, angular_width, energy_width, nullptr, output);
}

extern "C" int remagx_visnovsky_energy_scan_points(const RemagxMatrixLayer* layers, size_t layer_count,
                      const double* energies, const double* qz, const int* enabled, size_t point_count,
                      double epsilon, const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int analyzer, int scan_mode, double angular_width, double energy_width,
                      const RemagxEnergyPoint* settings, RemagxReflectivity* output) {
    if (!std::isfinite(epsilon)) return REMAGX_INVALID_ARGUMENT;
    return prepared_energy_scan(layers, layer_count, energies, qz, enabled, point_count, beam1, beam2,
        analyzer, scan_mode, angular_width, energy_width, settings, output,
        [&](const RemagxMatrixLayer* stack, const double* coordinate, double energy, double width, size_t index, RemagxReflectivity* result) {
            return remagx_visnovsky_qz_resolution(stack, layer_count, coordinate, 1, energy, settings ? settings[index].epsilon : epsilon,
                beam1, beam2, analyzer, scan_mode, width, 0, result);
        });
}

extern "C" int remagx_zak_energy_scan(const RemagxLayer* layers, size_t layer_count,
                      const double* energies, const double* qz, const int* enabled, size_t point_count,
                      int magnetic_enabled, const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int analyzer, int scan_mode, double angular_width, double energy_width,
                      RemagxReflectivity* output) {
    return remagx_zak_energy_scan_points(layers, layer_count, energies, qz, enabled, point_count, magnetic_enabled, beam1, beam2, analyzer, scan_mode, angular_width, energy_width, nullptr, output);
}

extern "C" int remagx_zak_energy_scan_points(const RemagxLayer* layers, size_t layer_count,
                      const double* energies, const double* qz, const int* enabled, size_t point_count,
                      int magnetic_enabled, const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int analyzer, int scan_mode, double angular_width, double energy_width,
                      const RemagxEnergyPoint* settings, RemagxReflectivity* output) {
    if (magnetic_enabled != 0 && magnetic_enabled != 1) return REMAGX_INVALID_ARGUMENT;
    return prepared_energy_scan(layers, layer_count, energies, qz, enabled, point_count, beam1, beam2,
        analyzer, scan_mode, angular_width, energy_width, settings, output,
        [&](const RemagxLayer* stack, const double* coordinate, double energy, double width, size_t, RemagxReflectivity* result) {
            return remagx_zak_qz_resolution(stack, layer_count, coordinate, 1, energy, magnetic_enabled,
                beam1, beam2, analyzer, scan_mode, width, 0, result);
        });
}
