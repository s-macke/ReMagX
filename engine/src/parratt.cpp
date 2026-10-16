#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <complex>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
using Complex = std::complex<double>;
constexpr double pi = 3.141592653589793238462643383279502884;
static_assert(std::numeric_limits<double>::is_iec559 && sizeof(double) == 8 &&
              std::numeric_limits<double>::digits == 53);

struct InterfaceReflection { Complex sigma; Complex pi; };

// Port of shared/simul/CParratt.h CalcKz/CalcR/BerechneIntensitaet (2.6).
// Preserve the legacy tetragonal weighting and zero-real-wave-number adjustment.
// This code contains no optimizer or Numerical Recipes implementation.
InterfaceReflection interface_reflection(const RemagxLayer& lower, Complex lower_index,
                                          Complex upper_index, Complex lower_wave, Complex upper_wave) {
    Complex pi_reflection = (lower_index * lower_index * upper_wave - upper_index * upper_index * lower_wave) /
                            (lower_index * lower_index * upper_wave + upper_index * upper_index * lower_wave);
    Complex sigma_reflection = (upper_wave - lower_wave) / (upper_wave + lower_wave);
    if (lower.roughness != 0.0) {
        const Complex damping = std::exp(lower_wave * upper_wave * (lower.roughness * lower.roughness) * -2.0);
        pi_reflection = pi_reflection * damping;
        sigma_reflection = sigma_reflection * damping;
    }
    return {sigma_reflection, pi_reflection};
}

double calculate_point(const RemagxLayer* layers, size_t layer_count, const RemagxParrattPoint& point,
                       double sigma_weight, double pi_weight, int tensor, int analyzer,
                       std::vector<Complex>& indices, std::vector<Complex>& waves) {
    const double cosine = std::cos(point.angle_radians);
    const double sine = std::sin(point.angle_radians);
    const double cosine_squared = cosine * cosine;
    for (size_t index = 0; index < layer_count; ++index) {
        const auto& layer = layers[index];
        Complex refractive_index(1.0 - layer.delta, layer.beta);
        if (point.magnetization != 0.0) {
            if (tensor == REMAGX_TETRAGONAL) {
                const Complex second_index(1.0 - layer.delta_magnetic, layer.beta_magnetic);
                refractive_index = refractive_index * sigma_weight +
                    (refractive_index * (1.0 - cosine_squared) + second_index * cosine_squared) * pi_weight;
            } else {
                refractive_index += Complex(layer.delta_magnetic, -layer.beta_magnetic) * point.magnetization *
                    (cosine * std::sin(layer.phi_degrees * (pi / 180.0)) * std::sin(layer.gamma_degrees * (pi / 180.0)) +
                     sine * std::cos(layer.phi_degrees * (pi / 180.0)));
            }
        }
        indices[index] = refractive_index;
        Complex wave = std::sqrt(refractive_index * refractive_index - cosine_squared) * point.vacuum_wave_number;
        if (wave.real() == 0.0) wave = Complex(1e-100, wave.imag());
        waves[index] = wave;
    }
    auto reflection = interface_reflection(layers[0], indices[0], indices[1], waves[0], waves[1]);
    for (size_t index = 1; index + 1 < layer_count; ++index) {
        const Complex propagation = std::exp(Complex(0.0, 2.0) * waves[index] * layers[index].thickness);
        const auto boundary = interface_reflection(layers[index], indices[index], indices[index + 1], waves[index], waves[index + 1]);
        reflection.pi = (boundary.pi + reflection.pi * propagation) / (boundary.pi * reflection.pi * propagation + 1.0);
        reflection.sigma = (boundary.sigma + reflection.sigma * propagation) / (boundary.sigma * reflection.sigma * propagation + 1.0);
    }
    const double sigma = (reflection.sigma * std::conj(reflection.sigma)).real() * sigma_weight;
    const double pi_intensity = (reflection.pi * std::conj(reflection.pi)).real() * pi_weight;
    if (analyzer == REMAGX_SIGMA) return sigma;
    if (analyzer == REMAGX_PI) return pi_intensity;
    return pi_intensity + sigma;
}

bool valid_layer(const RemagxLayer& layer) {
    return std::isfinite(layer.thickness) && layer.thickness >= 0.0 &&
        std::isfinite(layer.roughness) && layer.roughness >= 0.0 &&
        std::isfinite(layer.delta) && std::isfinite(layer.beta) &&
        std::isfinite(layer.delta_magnetic) && std::isfinite(layer.beta_magnetic) &&
        std::isfinite(layer.gamma_degrees) && std::isfinite(layer.phi_degrees);
}
}

extern "C" int remagx_parratt(const RemagxLayer* layers, size_t layer_count,
                               const RemagxParrattPoint* points, size_t point_count,
                               const RemagxBeam* beam, int tensor, int analyzer, double* output) {
    if (!layers || layer_count < 2 || !points || point_count == 0 || !beam || !output ||
        tensor < REMAGX_ISOTROPIC || tensor > REMAGX_TETRAGONAL || analyzer < REMAGX_BOTH || analyzer > REMAGX_PI)
        return REMAGX_INVALID_ARGUMENT;
    if (!std::isfinite(beam->sigma_real) || !std::isfinite(beam->sigma_imaginary) ||
        !std::isfinite(beam->pi_real) || !std::isfinite(beam->pi_imaginary)) return REMAGX_INVALID_ARGUMENT;
    const double sigma_weight = beam->sigma_real * beam->sigma_real + beam->sigma_imaginary * beam->sigma_imaginary;
    const double pi_weight = beam->pi_real * beam->pi_real + beam->pi_imaginary * beam->pi_imaginary;
    if (!std::isfinite(sigma_weight) || !std::isfinite(pi_weight)) return REMAGX_INVALID_ARGUMENT;
    for (size_t index = 0; index < layer_count; ++index) if (!valid_layer(layers[index])) return REMAGX_INVALID_ARGUMENT;
    for (size_t index = 0; index < point_count; ++index) {
        if (!std::isfinite(points[index].angle_radians) || !std::isfinite(points[index].vacuum_wave_number) ||
            points[index].vacuum_wave_number <= 0.0 || !std::isfinite(points[index].magnetization)) return REMAGX_INVALID_ARGUMENT;
    }
    try {
        std::vector<double> results(point_count);
        std::vector<Complex> indices(layer_count), waves(layer_count);
        for (size_t index = 0; index < point_count; ++index) {
            results[index] = calculate_point(layers, layer_count, points[index], sigma_weight, pi_weight, tensor, analyzer, indices, waves);
            if (!std::isfinite(results[index])) return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(results.begin(), results.end(), output);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
