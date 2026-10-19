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
