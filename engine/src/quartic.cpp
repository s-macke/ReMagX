#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <complex>

// CVisnovsky.h SolvePolynomial: analytic quartic branches followed by ten
// guarded Newton passes and the legacy mode-ordering comparisons.
extern "C" int remagx_quartic_roots(const double* coefficients, double* output) {
    if (!coefficients || !output) return REMAGX_INVALID_ARGUMENT;
    for (int index = 0; index < 10; ++index)
        if (!std::isfinite(coefficients[index])) return REMAGX_INVALID_ARGUMENT;
    using Complex = std::complex<double>;
    Complex leading(coefficients[0], coefficients[1]);
    if (leading == Complex(0.0, 0.0)) return REMAGX_INVALID_ARGUMENT;
    Complex cubic(coefficients[2], coefficients[3]);
    Complex quadratic(coefficients[4], coefficients[5]);
    Complex linear(coefficients[6], coefficients[7]);
    Complex constant(coefficients[8], coefficients[9]);
    constant /= leading;
    linear /= leading;
    quadratic /= leading;
    cubic /= leading;
    leading = 1.0;
    const Complex depressed_quadratic = -3.0*cubic*cubic/8.0/(leading*leading) + quadratic/leading;
    const Complex depressed_linear = cubic*cubic*cubic/8.0/(leading*leading*leading) - cubic*quadratic/2.0/(leading*leading) + linear/leading;
    const Complex depressed_constant = -3.0*cubic*cubic*cubic*cubic/256.0/(leading*leading*leading*leading) +
        cubic*cubic*quadratic/16.0/(leading*leading*leading) - cubic*linear/4.0/(leading*leading) + constant/leading;
    const Complex resolvent_linear = -depressed_quadratic*depressed_quadratic/12.0 - depressed_constant;
    const Complex resolvent_constant = -depressed_quadratic*depressed_quadratic*depressed_quadratic/108.0 +
        depressed_quadratic*depressed_constant/3.0 - depressed_linear*depressed_linear/8.0;
    Complex roots[4];
    if (depressed_linear == Complex(0.0, 0.0)) {
        const Complex discriminant = std::sqrt(depressed_quadratic*depressed_quadratic - 4.0*depressed_constant);
        const Complex shift = -cubic/4.0/leading;
        roots[0] = shift + std::sqrt((-depressed_quadratic + discriminant)/2.0);
        roots[1] = shift + std::sqrt((-depressed_quadratic - discriminant)/2.0);
        roots[2] = shift - std::sqrt((-depressed_quadratic + discriminant)/2.0);
        roots[3] = shift - std::sqrt((-depressed_quadratic - discriminant)/2.0);
    } else {
        Complex resolvent_root;
        if (resolvent_linear == Complex(0.0, 0.0)) {
            resolvent_root = -5.0*depressed_quadratic/6.0 - std::pow(resolvent_constant, 1.0/3.0);
        } else {
            const Complex cube_root = std::pow(resolvent_constant/2.0 + std::sqrt(resolvent_constant*resolvent_constant/4.0 +
                resolvent_linear*resolvent_linear*resolvent_linear/27.0), 1.0/3.0);
            resolvent_root = -5.0*depressed_quadratic/6.0 + resolvent_linear/3.0/cube_root - cube_root;
        }
        const Complex radical = std::sqrt(depressed_quadratic + 2.0*resolvent_root);
        const Complex shift = -cubic/4.0/leading;
        const Complex inner = -(depressed_quadratic + 2.0*resolvent_root) - 2.0*depressed_quadratic;
        const auto root = [&](Complex outer_sign, Complex radical_sign) {
            return shift + 1.0/2.0*(radical_sign*radical + outer_sign*std::sqrt(inner + 2.0*radical_sign*depressed_linear/radical));
        };
        roots[1] = root(1.0, 1.0);
        roots[0] = root(1.0, -1.0);
        roots[3] = root(-1.0, 1.0);
        roots[2] = root(-1.0, -1.0);
    }
    const auto residual = [&](Complex value) {
        return ((((leading*value + cubic)*value) + quadratic)*value + linear)*value + constant;
    };
    for (int pass = 0; pass < 10; ++pass) for (auto& root : roots) {
        const Complex derivative = (((4.0*leading*root + 3.0*cubic)*root) + 2.0*quadratic)*root + linear;
        if (std::abs(derivative) < 1e-13) continue;
        const Complex before = residual(root);
        root -= before/derivative;
        if (std::abs(residual(root)) > std::abs(before)) root += before/derivative;
    }
    for (int pass = 0; pass < 3; ++pass) for (int index = 0; index < 3; ++index)
        if (roots[index].real() < roots[index + 1].real()) std::swap(roots[index], roots[index + 1]);
    if (roots[0].imag() < roots[1].imag()) std::swap(roots[0], roots[1]);
    if (roots[2].imag() < roots[3].imag()) std::swap(roots[2], roots[3]);
    double values[8];
    for (int index = 0; index < 4; ++index) {
        values[index*2] = roots[index].real();
        values[index*2+1] = roots[index].imag();
        if (!std::isfinite(values[index*2]) || !std::isfinite(values[index*2+1])) return REMAGX_NUMERICAL_ERROR;
    }
    std::copy(values, values + 8, output);
    return REMAGX_SUCCESS;
}
