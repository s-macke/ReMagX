#include "remagx/fit_error.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

extern "C" int remagx_fit_dataset_error(int mode, const double* qz, const double* energy,
    const double* measured, const double* calculated,
    const double* measured_second, const double* calculated_second, size_t count,
    double qz_min, double qz_max, double energy_min, double energy_max,
    double* error, size_t* accepted, double* residuals) {
    const bool energy_window = mode == REMAGX_FIT_ENERGY_LOG || mode == REMAGX_FIT_ENERGY_LINEAR;
    const bool dichroic = mode == REMAGX_FIT_DICHROIC || mode == REMAGX_FIT_ENERGY_DICHROIC;
    const bool asymmetry = mode == REMAGX_FIT_ASYMMETRY || mode == REMAGX_FIT_ENERGY_ASYMMETRY;
    const bool linear = mode == REMAGX_FIT_REFLECTIVITY_LINEAR || mode == REMAGX_FIT_ENERGY_LINEAR;
    if (mode < REMAGX_FIT_REFLECTIVITY_LOG || mode > REMAGX_FIT_ENERGY_DICHROIC || !error || !accepted ||
        !std::isfinite(qz_min) || !std::isfinite(qz_max) ||
        (energy_window && (!std::isfinite(energy_min) || !std::isfinite(energy_max))) ||
        (count && (!qz || !measured || !calculated || (energy_window && !energy) ||
                   (dichroic && (!measured_second || !calculated_second))))) return REMAGX_INVALID_ARGUMENT;
    if (count > std::numeric_limits<size_t>::max() / sizeof(double)) return REMAGX_ALLOCATION_ERROR;
    for (size_t index = 0; index < count; ++index) {
        if (!std::isfinite(qz[index]) || !std::isfinite(measured[index]) || !std::isfinite(calculated[index]) ||
            (energy_window && !std::isfinite(energy[index])) ||
            (dichroic && (!std::isfinite(measured_second[index]) || !std::isfinite(calculated_second[index]))))
            return REMAGX_INVALID_ARGUMENT;
    }
    try {
        std::vector<double> differences;
        if (residuals && count) differences.assign(residuals, residuals + count);
        double sum = 0.0;
        size_t used = 0;
        for (size_t index = 0; index < count; ++index) {
            if (qz[index] < qz_min || qz[index] > qz_max) continue;
            if (energy_window && (energy[index] < energy_min || energy[index] > energy_max)) continue;
            if (!asymmetry && (measured[index] <= 0.0 || calculated[index] <= 0.0)) continue;
            if (dichroic && (measured_second[index] <= 0.0 || calculated_second[index] <= 0.0)) continue;
            ++used;
            double difference = linear || asymmetry ? measured[index] - calculated[index]
                : std::log10(measured[index]) - std::log10(calculated[index]);
            sum += difference * difference;
            if (dichroic) {
                const double second_difference = std::log10(measured_second[index]) - std::log10(calculated_second[index]);
                sum += second_difference * second_difference;
                difference = std::abs(difference) + std::abs(second_difference);
            }
            if (residuals) differences[index] = difference;
        }
        if (used) sum /= static_cast<double>(used);
        if (!std::isfinite(sum)) return REMAGX_NUMERICAL_ERROR;
        if (residuals) std::copy(differences.begin(), differences.end(), residuals);
        *error = sum;
        *accepted = used;
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
