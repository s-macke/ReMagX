#pragma once
#include "complex_primitives.h"
#include <cmath>
#include <complex>

#ifdef __EMSCRIPTEN__
extern "C" double remagx_reference_math_atan2(double, double);
extern "C" double remagx_reference_math_cos(double);
extern "C" double remagx_reference_math_asin(double);
#endif
namespace remagx {
inline double reference_cosine(double value) {
#ifdef __EMSCRIPTEN__
    return remagx_reference_math_cos(value);
#else
    return std::cos(value);
#endif
}
inline double reference_inverse_sine(double value) {
#ifdef __EMSCRIPTEN__
    return remagx_reference_math_asin(value);
#else
    return std::asin(value);
#endif
}
// Use the C complex primitives on both platforms. libc++ reconstructs these
// operations through polar coordinates, unlike the native reference library.
inline std::complex<double> reference_complex_square_root(std::complex<double> value) {
    const auto result = remagx_complex_square_root(value.real(), value.imag());
    return {result.real, result.imaginary};
}
inline std::complex<double> reference_complex_power(std::complex<double> value, double exponent) {
    if (value.imag() == 0.0 && value.real() > 0.0) return std::pow(value.real(), exponent);
    const auto logarithm = remagx_complex_logarithm(value.real(), value.imag());
    const double magnitude = std::exp(exponent * logarithm.real);
#ifdef __EMSCRIPTEN__
    const double argument = remagx_reference_math_atan2(value.imag(), value.real());
#else
    const double argument = logarithm.imaginary;
#endif
    const double angle = exponent * argument;
    return {magnitude * std::cos(angle), magnitude * std::sin(angle)};
}
}
