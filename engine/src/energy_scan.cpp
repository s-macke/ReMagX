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

extern "C" int remagx_parratt_energy_scan(const RemagxLayer* layers, size_t layer_count,
                      const double* energies, const double* qz, const int* enabled, size_t point_count,
                      const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int tensor, int analyzer, int magnetization_enabled, int scan_mode,
                      double angular_width, double energy_width, RemagxReflectivity* output) {
    if (!layers || layer_count < 2 || !energies || !qz || !point_count || !output ||
        !valid_beam(beam1) || (scan_mode == REMAGX_DICHROIC && !valid_beam(beam2)) ||
        (scan_mode != REMAGX_MONOCHROMATIC && scan_mode != REMAGX_DICHROIC) ||
        (tensor != REMAGX_ISOTROPIC && tensor != REMAGX_TETRAGONAL) ||
        analyzer < REMAGX_BOTH || analyzer > REMAGX_PI ||
        (magnetization_enabled != 0 && magnetization_enabled != 1) ||
        !std::isfinite(angular_width) || angular_width < 0.0 ||
        !std::isfinite(energy_width) || energy_width < 0.0) return REMAGX_INVALID_ARGUMENT;
    if (point_count > std::numeric_limits<size_t>::max() / sizeof(RemagxLayer) / layer_count)
        return REMAGX_ALLOCATION_ERROR;
    for (size_t index = 0; index < point_count; ++index)
        if (!std::isfinite(energies[index]) || energies[index] <= 0.0 || !std::isfinite(qz[index]) ||
            (enabled && enabled[index] != 0 && enabled[index] != 1)) return REMAGX_INVALID_ARGUMENT;
    try {
        // CalcEScan / CalcDicEScan leave these values in place when Filldb fails
        // its energy-range check; skipped points still participate in convolution.
        std::vector<RemagxReflectivity> raw(point_count,
            {1.0, scan_mode == REMAGX_DICHROIC ? 1.0 : 0.0});
        for (size_t index = 0; index < point_count; ++index) {
            if (enabled && !enabled[index]) continue;
            const int status = remagx_parratt_qz_resolution(layers + index * layer_count, layer_count,
                qz + index, 1, energies[index], beam1, beam2, tensor, analyzer, magnetization_enabled,
                scan_mode, angular_width, 0, &raw[index]);
            if (status != REMAGX_SUCCESS) return status;
        }
        // This API commits its output only after convolution also succeeds.
        return remagx_energy_resolution(energies, raw.data(), point_count, energy_width, output);
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
