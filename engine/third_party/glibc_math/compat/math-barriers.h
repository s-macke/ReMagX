#pragma once
#define math_force_eval(value) do { volatile double remagx_math_value = (value); (void)remagx_math_value; } while (0)
static inline double remagx_math_barrier(double value) {
    volatile double result = value;
    return result;
}
#define math_opt_barrier(value) remagx_math_barrier(value)
