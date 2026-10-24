#pragma once
#include <math.h>
#include <stdint.h>
#include <string.h>
// Pin binary64 evaluation and public names; upstream arithmetic is unchanged.
#define double_t double
#define erf remagx_standard_erf
#define erfc remagx_standard_erfc
#define exp remagx_reference_math_exp
extern double remagx_reference_math_exp(double);
#define GET_HIGH_WORD(result, value) do { \
    double remagx_value = (value); uint64_t remagx_bits; \
    memcpy(&remagx_bits, &remagx_value, sizeof(remagx_bits)); \
    (result) = (uint32_t)(remagx_bits >> 32); \
} while (0)
#define SET_LOW_WORD(value, low) do { \
    uint64_t remagx_bits; memcpy(&remagx_bits, &(value), sizeof(remagx_bits)); \
    remagx_bits = (remagx_bits & UINT64_C(0xffffffff00000000)) | (uint32_t)(low); \
    memcpy(&(value), &remagx_bits, sizeof(remagx_bits)); \
} while (0)
