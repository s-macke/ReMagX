#pragma once
#include "complex_primitives.h"
#include <cmath>
#include <algorithm>
#include <limits>
#include <complex>

#ifdef REMAGX_REFERENCE_MATH
extern "C" double remagx_reference_math_atan2(double, double);
extern "C" double remagx_reference_math_cos(double);
extern "C" double remagx_reference_math_exp(double);
extern "C" double remagx_reference_math_sin(double);
extern "C" double remagx_reference_math_asin(double);
#endif
namespace remagx {
// Ratio-scaled complex division preserves the native compiler's arithmetic
// sequence. WASM's compiler runtime otherwise uses squared-denominator scaling.
inline std::complex<double> reference_complex_divide(std::complex<double> numerator, std::complex<double> denominator) {
    const double real = denominator.real(), imaginary = denominator.imag();
    // Leave exceptional and extreme-scale handling to the platform runtime.
    const double magnitude = std::max(std::abs(real), std::abs(imaginary));
    const double numerator_magnitude = std::max(std::abs(numerator.real()), std::abs(numerator.imag()));
    const double lower = std::sqrt(std::numeric_limits<double>::min());
    const double upper = std::sqrt(std::numeric_limits<double>::max());
    if (!std::isfinite(magnitude) || !std::isfinite(numerator_magnitude) ||
        magnitude < lower || magnitude > upper || numerator_magnitude > upper)
        return numerator / denominator;
    if (std::abs(real) >= std::abs(imaginary) && real != 0.0) {
        const double ratio = imaginary / real;
        const double divisor = imaginary * ratio + real;
        return {(numerator.real() + numerator.imag() * ratio) / divisor,
                (numerator.imag() - numerator.real() * ratio) / divisor};
    }
    if (imaginary != 0.0) {
        const double ratio = real / imaginary;
        const double divisor = real * ratio + imaginary;
        return {(numerator.real() * ratio + numerator.imag()) / divisor,
                (numerator.imag() * ratio - numerator.real()) / divisor};
    }
    return numerator / denominator;
}
inline double reference_cosine(double value) {
#ifdef REMAGX_REFERENCE_MATH
    return remagx_reference_math_cos(value);
#else
    return std::cos(value);
#endif
}
inline double reference_sine(double value) {
#ifdef REMAGX_REFERENCE_MATH
    return remagx_reference_math_sin(value);
#else
    return std::sin(value);
#endif
}
inline double reference_inverse_sine(double value) {
#ifdef REMAGX_REFERENCE_MATH
    return remagx_reference_math_asin(value);
#else
    return std::asin(value);
#endif
}
inline std::complex<double> reference_complex_exponential(std::complex<double> value) {
#ifdef REMAGX_REFERENCE_MATH
    const double magnitude = remagx_reference_math_exp(value.real());
    if (std::isfinite(magnitude) && std::isfinite(value.imag()))
        return {magnitude * remagx_reference_math_cos(value.imag()),
                magnitude * remagx_reference_math_sin(value.imag())};
#endif
    return std::exp(value);
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
    const double magnitude = remagx_reference_math_exp(exponent * logarithm.real);
#ifdef REMAGX_REFERENCE_MATH
    const double argument = remagx_reference_math_atan2(value.imag(), value.real());
#else
    const double argument = logarithm.imaginary;
#endif
    const double angle = exponent * argument;
#ifdef REMAGX_REFERENCE_MATH
    return {magnitude * remagx_reference_math_cos(angle), magnitude * remagx_reference_math_sin(angle)};
#else
    return {magnitude * std::cos(angle), magnitude * std::sin(angle)};
#endif
}
}
