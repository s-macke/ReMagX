#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
// Active constants in shared/RechenHilfe.h, not a regenerated quadrature.
constexpr double offsets[] = {-2, -1.77777777777778, -1.55555555555556, -1.33333333333333,
  -1.11111111111111, -.888888888888889, -.666666666666667, -.444444444444444,
  -.222222222222222, 0, .222222222222222, .444444444444444, .666666666666667,
  .888888888888889, 1.11111111111111, 1.33333333333333, 1.55555555555556, 1.77777777777778, 2};
constexpr double weights[] = {.00377799105508597, .00543307167196355, .0113273887261945,
  .0214123599246999, .0366987921471986, .0570286832606567, .0803509037851472,
  .102646753546022, .118893345923233, .124861419919597, .118893345923233,
  .102646753546022, .0803509037851472, .0570286832606567, .0366987921471986,
  .0214123599246999, .0113273887261945, .00543307167196355, .00377799105508597};

RemagxReflectivity interpolate(const double* qz, const std::vector<RemagxReflectivity>& values,
                              size_t position, double target) {
    const auto linear = [&](size_t left, size_t right) {
        const double fraction = (qz[left] - target) / (qz[left] - qz[right]);
        return RemagxReflectivity{
            values[left].beam1 - fraction * (values[left].beam1 - values[right].beam1),
            values[left].beam2 - fraction * (values[left].beam2 - values[right].beam2)};
    };
    // RechenHilfe.cpp GetLinY: preserve the omitted last forward interval.
    if (qz[position] < target) {
        for (size_t index = position + 1; index + 1 < values.size(); ++index)
            if (qz[index] > target) return linear(index - 1, index);
    } else {
        for (size_t index = position; index > 0; --index)
            if (qz[index - 1] < target) return linear(index - 1, index);
    }
    return values[position];
}
}

extern "C" int remagx_parratt_qz_resolution(const RemagxLayer* layers, size_t layer_count,
                      const double* qz, size_t point_count, double energy_ev,
                      const RemagxBeam* beam1, const RemagxBeam* beam2,
                      int tensor, int analyzer, int magnetization_enabled,
                      int scan_mode, double width, int fast, RemagxReflectivity* output) {
    if (!layers || layer_count < 2 || !qz || !point_count || !beam1 || !output ||
        !std::isfinite(width) || width < 0.0 || (fast != 0 && fast != 1)) return REMAGX_INVALID_ARGUMENT;
    const size_t samples = !fast && width < 1e-10 ? 1 : 19;
    if (!fast && point_count > std::numeric_limits<size_t>::max() / samples) return REMAGX_ALLOCATION_ERROR;
    try {
        std::vector<double> coordinates(fast ? point_count : point_count * samples);
        for (size_t index = 0; index < point_count; ++index) {
            if (!std::isfinite(qz[index])) return REMAGX_INVALID_ARGUMENT;
            if (fast) coordinates[index] = qz[index];
            else for (size_t sample = 0; sample < samples; ++sample) {
                coordinates[index * samples + sample] = qz[index] + offsets[sample] * width;
                if (!std::isfinite(coordinates[index * samples + sample])) return REMAGX_NUMERICAL_ERROR;
            }
        }
        std::vector<RemagxReflectivity> raw(coordinates.size());
        const int status = remagx_parratt_qz(layers, layer_count, coordinates.data(), coordinates.size(), energy_ev,
                                            beam1, beam2, tensor, analyzer, magnetization_enabled, scan_mode, raw.data());
        if (status != REMAGX_SUCCESS) return status;
        if (fast) {
            const double wave = 2.0 * 3.141592653589793238462643383279502884 / (12398.326 / energy_ev);
            for (size_t index = 0; index < point_count; ++index) {
                if (scan_mode == REMAGX_DICHROIC && qz[index] / (wave * 2.0) >= 1.0) return REMAGX_QZ_ERROR;
                if (qz[index] < 0.0) raw[index] = {1.0, scan_mode == REMAGX_DICHROIC ? 1.0 : 0.0};
            }
        }
        std::vector<RemagxReflectivity> results(point_count, {0.0, 0.0});
        for (size_t index = 0; index < point_count; ++index) {
            for (size_t sample = 0; sample < samples; ++sample) {
                const double weight = samples == 1 ? 1.0 : weights[sample];
                const double coordinate = qz[index] + offsets[sample] * width;
                if (fast && coordinate < 0.0) continue;
                const auto value = fast ? interpolate(qz, raw, index, coordinate) : raw[index * samples + sample];
                results[index].beam1 += weight * value.beam1;
                if (scan_mode == REMAGX_DICHROIC) results[index].beam2 += weight * value.beam2;
            }
            if (!std::isfinite(results[index].beam1) || !std::isfinite(results[index].beam2)) return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(results.begin(), results.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}

// CalcEScan / CalcDicEScan apply this interpolation kernel after the full scan,
// before asymmetry and other postprocessing. It is independent of fast settings.
extern "C" int remagx_energy_resolution(const double* energies,
                      const RemagxReflectivity* input, size_t point_count,
                      double width, RemagxReflectivity* output) {
    if (!energies || !input || !output || !point_count || !std::isfinite(width) || width < 0.0)
        return REMAGX_INVALID_ARGUMENT;
    for (size_t index = 0; index < point_count; ++index)
        if (!std::isfinite(energies[index]) || !std::isfinite(input[index].beam1) ||
            !std::isfinite(input[index].beam2)) return REMAGX_INVALID_ARGUMENT;
    try {
        const std::vector<RemagxReflectivity> source(input, input + point_count);
        std::vector<RemagxReflectivity> results(point_count, {0.0, 0.0});
        if (width < 1e-10) results = source;
        else for (size_t index = 0; index < point_count; ++index) {
            for (size_t sample = 0; sample < 19; ++sample) {
                const double energy = energies[index] + offsets[sample] * width;
                if (!std::isfinite(energy)) return REMAGX_NUMERICAL_ERROR;
                if (energy < 0.0) continue;
                const auto value = interpolate(energies, source, index, energy);
                results[index].beam1 += weights[sample] * value.beam1;
                results[index].beam2 += weights[sample] * value.beam2;
            }
            if (!std::isfinite(results[index].beam1) || !std::isfinite(results[index].beam2))
                return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(results.begin(), results.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
