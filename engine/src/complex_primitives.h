#pragma once
#ifdef __cplusplus
extern "C" {
#endif
struct RemagxComplexValue { double real; double imaginary; };
struct RemagxComplexValue remagx_complex_square_root(double real, double imaginary);
struct RemagxComplexValue remagx_complex_logarithm(double real, double imaginary);
#ifdef __cplusplus
}
#endif
