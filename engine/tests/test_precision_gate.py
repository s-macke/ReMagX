import unittest
from check_precision import forbidden_precision


class PrecisionGateTest(unittest.TestCase):
    def test_rejects_types_and_literal_suffixes(self):
        for source in ['float x;', 'long double x;', 'std::complex<float> x;', 'auto x = 1.0f;', 'auto x = 1e-3L;', '_Float128 x;', 'mpfr_t x;', 'auto x = 0x1.fp3f;', 'std::float32_t x;', 'boost::multiprecision::cpp_dec_float_50 x;']:
            self.assertTrue(forbidden_precision(source), source)

    def test_accepts_double_comments_and_descriptive_identifiers(self):
        self.assertFalse(forbidden_precision('double value = 1.0; int floating_count = 2; // float\n/* long double */'))
        self.assertFalse(forbidden_precision('const char* message = "float"; std::complex<double> value;'))


if __name__ == '__main__':
    unittest.main()
