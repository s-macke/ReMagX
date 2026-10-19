#pragma once
#define math_force_eval(value) do { volatile double remagx_math_value = (value); (void)remagx_math_value; } while (0)
