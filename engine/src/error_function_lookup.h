#ifndef REMAGX_ERROR_FUNCTION_LOOKUP_H
#define REMAGX_ERROR_FUNCTION_LOOKUP_H
namespace {
// Consume the original 1001-sample layout without choosing how its samples are
// generated. Legacy initialization uses denominator 999, including a guard point.
inline double errorFunction(double position, const double* samples) {
    if (position < -5.0) return -1.0;
    if (position > 5.0) return 1.0;
    const double coordinate = 0.0 - (-5.0 - position) / (-5.0 - 5.0) * (0.0 - 999.0);
    const int left = static_cast<int>(coordinate);
    return samples[left] - (left - coordinate) / (left - (left + 1.0)) * (samples[left] - samples[left + 1]);
}
}

#endif
