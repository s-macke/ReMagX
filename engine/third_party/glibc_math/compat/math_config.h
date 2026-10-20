#pragma once
#include <stdint.h>
#include <string.h>
#define USE_FMAX_BUILTIN 0
#define USE_FMIN_BUILTIN 0
static inline int issignaling_inline(double value) {
    uint64_t bits;
    memcpy(&bits, &value, sizeof(bits));
    return (bits & UINT64_C(0x7ff8000000000000)) == UINT64_C(0x7ff0000000000000)
        && (bits & UINT64_C(0x0007ffffffffffff)) != 0;
}

// Portable binary64 integration for the unmodified exponential implementation.
#include <errno.h>
#include <math.h>
#define WANT_ROUNDING 1
#define TOINT_INTRINSICS 0
#define EXP_TABLE_BITS 7
#define EXP_POLY_ORDER 5
#define EXP2_POLY_ORDER 5
static inline uint64_t asuint64(double value) {
    uint64_t bits;
    memcpy(&bits, &value, sizeof(bits));
    return bits;
}
static inline double asdouble(uint64_t bits) {
    double value;
    memcpy(&value, &bits, sizeof(value));
    return value;
}
static inline double check_oflow(double value) {
    if (isinf(value)) errno = ERANGE;
    return value;
}
static inline double check_uflow(double value) {
    if (value == 0.0) errno = ERANGE;
    return value;
}
static inline double __math_oflow(unsigned int negative) {
    volatile double magnitude = 0x1p769;
    errno = ERANGE;
    return (negative ? -magnitude : magnitude) * magnitude;
}
static inline double __math_uflow(unsigned int negative) {
    volatile double magnitude = 0x1p-767;
    errno = ERANGE;
    return (negative ? -magnitude : magnitude) * magnitude;
}
extern const struct exp_data {
    double invln2N, negln2hiN, negln2loN;
    double poly[4];
    double shift, exp2_shift;
    double exp2_poly[EXP2_POLY_ORDER];
    double neglog10_2hiN, neglog10_2loN;
    double exp10_poly[5];
    double invlog10_2N;
    uint64_t tab[2 * (1 << EXP_TABLE_BITS)];
} __exp_data;
