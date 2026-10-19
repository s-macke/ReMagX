#pragma once
// WASM exposes no floating-point exception flags; preserve the numeric return.
#define math_check_force_underflow(value) ((void)(value))
#define math_check_force_underflow_nonneg(value) ((void)(value))
