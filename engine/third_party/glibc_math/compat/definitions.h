#pragma once
// Integration names only; upstream arithmetic and coefficient tables are unmodified.
#define __ieee754_atan2 remagx_reference_math_atan2
#define __ieee754_asin remagx_reference_math_asin
#define __ieee754_acos remagx_reference_math_acos
#define __sin remagx_reference_math_sin
#define __cos remagx_reference_math_cos
#define __branred remagx_reference_math_reduce
#define __sincostab remagx_reference_math_sincos_table
#define attribute_hidden

#define __hypot remagx_reference_math_hypot
#define strong_alias(original, alias)
#ifndef __glibc_unlikely
#define __glibc_unlikely(value) __builtin_expect(!!(value), 0)
#endif
// Instantiate the upstream complex sqrt/log templates for binary64 only.
#include <float.h>
#include <math.h>
#include <complex.h>
#define FLOAT double
#define CFLOAT double _Complex
#define __csqrt remagx_reference_math_csqrt
#define __clog remagx_reference_math_clog
#define M_DECL_FUNC(name) name
#define M_HUGE_VAL HUGE_VAL
#define M_NAN NAN
#define M_FABS fabs
#define M_COPYSIGN copysign
#define M_SQRT sqrt
#define M_SCALBN scalbn
#define M_MAX DBL_MAX
#define M_MIN DBL_MIN
#define M_MANT_DIG DBL_MANT_DIG
#define M_LIT(value) value
#define M_HYPOT remagx_reference_math_hypot
#define declare_mgen_alias(original, alias)
extern double remagx_reference_math_hypot(double, double);

#ifndef __glibc_likely
#define __glibc_likely(value) __builtin_expect(!!(value), 1)
#endif
#define __x2y2m1 remagx_reference_math_x2y2m1
#define M_SUF(name) name
#define M_MLIT(value) value
#define M_EPSILON DBL_EPSILON
#define M_LOG log
#define M_LOG1P log1p
#define M_ATAN2 remagx_reference_math_atan2
extern double remagx_reference_math_atan2(double, double);
extern double remagx_reference_math_x2y2m1(double, double);

#define __exp remagx_reference_math_exp
#define __exp_data remagx_reference_math_exp_data
