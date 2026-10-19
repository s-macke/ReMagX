#pragma once
// WebAssembly memory is little endian. Native diagnostic builds must agree.
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error "Reference math diagnostic requires a little-endian target"
#endif
#define LITTLE_ENDI 1
#define HIGH_HALF 1
#define LOW_HALF 0
