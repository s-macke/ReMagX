#pragma once
// Supported native and WebAssembly builds use little-endian memory.
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error "Reference math requires a little-endian target"
#endif
#define LITTLE_ENDI 1
#define HIGH_HALF 1
#define LOW_HALF 0
