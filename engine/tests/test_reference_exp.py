"""CPU-independent rounding and exceptional cases for the pinned exponential."""
import ctypes
import math
import sys
import unittest

library = ctypes.CDLL(sys.argv.pop(1), use_errno=True)
exponential = library.remagx_reference_math_exp
exponential.argtypes = [ctypes.c_double]
exponential.restype = ctypes.c_double


class ReferenceExponential(unittest.TestCase):
    def test_magnetic_regression_rounding(self):
        # FMA libm differs by one ULP here, amplified by Visnovsky case 2524.
        self.assertEqual(exponential(float.fromhex('-0x1.13b2fd8247d7p+2')).hex(),
                         '0x1.b92900f9b037ep-7')

    def test_range_and_special_values(self):
        for value in (-0.0, 0.0):
            self.assertEqual(exponential(value), 1.0)
        self.assertEqual(exponential(-math.inf), 0.0)
        self.assertEqual(exponential(math.inf), math.inf)
        self.assertTrue(math.isnan(exponential(math.nan)))
        self.assertEqual(exponential(1024.0), math.inf)
        self.assertEqual(exponential(-1024.0), 0.0)
        for value in (-745.0, -744.0, -710.0, -708.0, -512.0, -1.0,
                      1e-20, 1.0, 512.0, 709.0):
            expected = math.exp(value)
            self.assertLessEqual(abs(exponential(value) - expected), math.ulp(expected))


if __name__ == '__main__':
    unittest.main()
