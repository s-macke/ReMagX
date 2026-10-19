#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <new>
#include <stdexcept>
#include <vector>

namespace {
using Complex = std::complex<double>;
constexpr double pi = 3.14159265358979323846;
constexpr double legacy_pi = 3.141592;

// Iterative radix-two transform. All data and twiddle arithmetic is binary64.
void transform(std::vector<Complex>& data, bool inverse) {
    const size_t count = data.size();
    for (size_t index = 1, reversed = 0; index < count; ++index) {
        size_t bit = count >> 1;
        while (reversed & bit) { reversed ^= bit; bit >>= 1; }
        reversed ^= bit;
        if (index < reversed) std::swap(data[index], data[reversed]);
    }
    for (size_t width = 2; width <= count; width *= 2) {
        const size_t half = width / 2;
        for (size_t offset = 0; offset < half; ++offset) {
            const double angle = (inverse ? 2.0 : -2.0) * pi * static_cast<double>(offset) / static_cast<double>(width);
            const Complex twiddle(std::cos(angle), std::sin(angle));
            for (size_t start = 0; start < count; start += width) {
                const Complex first = data[start + offset];
                const Complex second = twiddle * data[start + offset + half];
                data[start + offset] = first + second;
                data[start + offset + half] = first - second;
            }
        }
    }
    if (inverse) for (auto& value : data) value /= static_cast<double>(count);
}

// n*k = (n*n+k*k-(n-k)*(n-k))/2 converts any-length DFT into
// a convolution of chirps. Padding is for that convolution, not the input DFT.
std::vector<Complex> forward(const std::vector<double>& input) {
    const size_t count = input.size();
    if ((count & (count - 1)) == 0) {
        std::vector<Complex> result(input.begin(), input.end());
        transform(result, false);
        return result;
    }
    size_t padded = 1;
    while (padded < 2 * count - 1) padded *= 2;
    std::vector<Complex> signal(padded), kernel(padded), chirp(count);
    for (size_t index = 0; index < count; ++index) {
        // Reducing the square before conversion avoids large-angle trig error.
        const auto square = (static_cast<uint64_t>(index) * index) % (2 * count);
        const double angle = pi * static_cast<double>(square) / static_cast<double>(count);
        chirp[index] = Complex(std::cos(angle), -std::sin(angle));
        signal[index] = input[index] * chirp[index];
        kernel[index] = std::conj(chirp[index]);
        if (index) kernel[padded - index] = kernel[index];
    }
    transform(signal, false);
    transform(kernel, false);
    for (size_t index = 0; index < padded; ++index) signal[index] *= kernel[index];
    transform(signal, true);
    signal.resize(count);
    for (size_t index = 0; index < count; ++index) signal[index] *= chirp[index];
    return signal;
}
}

extern "C" int remagx_fourier(const double* qz, const double* reflectivity, size_t count,
                               double* depths, double* magnitudes) {
    if (!qz || !reflectivity || !depths || !magnitudes || count < 2 || count > 1000000)
        return REMAGX_INVALID_ARGUMENT;
    for (size_t index = 0; index < count; ++index)
        if (!std::isfinite(qz[index]) || !std::isfinite(reflectivity[index])) return REMAGX_INVALID_ARGUMENT;
    if (qz[count - 1] == 0.0) return REMAGX_NUMERICAL_ERROR;
    try {
        std::vector<double> windowed(count);
        for (size_t index = 0; index < count; ++index) {
            const double squared = qz[index] * qz[index];
            const double scaled = reflectivity[index] * (squared * squared);
            windowed[index] = scaled * (0.5 * (1.0 - std::cos(2.0 * legacy_pi * static_cast<double>(index) / static_cast<double>(count + 1))));
            if (!std::isfinite(windowed[index])) return REMAGX_NUMERICAL_ERROR;
        }
        // CDataSet::FFT populates R0 but passes its original, windowed R to FFTW.
        const auto spectrum = forward(windowed);
        std::vector<double> coordinates(count / 2), values(count / 2);
        for (size_t index = 0; index < count / 2; ++index) {
            coordinates[index] = 2.0 * legacy_pi * static_cast<double>(index) / qz[count - 1];
            values[index] = index == 0 ? 0.0 : std::sqrt(spectrum[index].real() * spectrum[index].real() + spectrum[index].imag() * spectrum[index].imag());
            if (!std::isfinite(coordinates[index]) || !std::isfinite(values[index])) return REMAGX_NUMERICAL_ERROR;
        }
        std::copy(coordinates.begin(), coordinates.end(), depths);
        std::copy(values.begin(), values.end(), magnitudes);
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
