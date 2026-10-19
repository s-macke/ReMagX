#pragma once
#include <fenv.h>
// WASM arithmetic always rounds to nearest; it has no mutable rounding mode.
// Native standalone diagnostics run under their default nearest rounding mode.
#define SET_RESTORE_ROUND(mode) ((void)(mode))
#define SET_RESTORE_ROUND_53BIT(mode) ((void)(mode))
