import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

library = ctypes.CDLL(sys.argv.pop(1))
function = library.remagx_gauss_lorentzian_imag
function.argtypes = [ctypes.c_double] * 5 + [ctypes.POINTER(ctypes.c_double)]

def evaluate(parameters):
    output = ctypes.c_double(-123)
    status = function(*parameters, ctypes.byref(output))
    return status, output.value

def cases():
    return [[center + offset * max(width, 1e-5), center, -.03 if mix < 0 else .03, width, mix]
            for center in [100., 640., 8000.] for width in [-1., 0., 1e-6, .1, 2.]
            for mix in [-20., 0., 25., 50., 100., 120.] for offset in [-10., -2., -.1, 0., .1, 2., 10.]]

class LineShapeTest(unittest.TestCase):
    def test_center_width_clamp_and_pure_limits(self):
        for width in [-1., 0., 1e-6, 1e-5, .1]:
            self.assertEqual(evaluate([640, 640, -.03, width, 50]), (0, -.03 / max(width, 1e-5)))
        self.assertEqual(evaluate([641, 640, 2, 2, 100]), (0, .5))
        self.assertEqual(evaluate([641, 640, 2, 2, 0]), (0, .5))

    def test_nonfinite_inputs_and_results_are_atomic(self):
        for index in range(5):
            parameters = [640, 640, .03, .1, 50]
            parameters[index] = math.nan
            self.assertEqual(evaluate(parameters), (1, -123))
        self.assertEqual(evaluate([1, 0, 1, 2, -100]), (2, -123))
        self.assertEqual(evaluate([1e308, 0, 1, 1, 0]), (2, -123))
        self.assertEqual(function(640, 640, .03, .1, 50, None), 1)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original comparison not requested')
    def test_original_helper(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/scriptfunctions.cpp').read_text()
        source = source[source.index('double GetGaussLorentzianIm('):source.index('double GetGaussLorentzianRe(')]
        self.assertEqual(hashlib.sha256(source.encode()).hexdigest(), '0292a0a56a40e57fddfbffb7c89ce678f6a30c8aa21c13aa2a9c175809c71496')
        with tempfile.TemporaryDirectory(prefix='remagx-line-shape-') as directory:
            path = Path(directory)
            (path / 'reference.cpp').write_text('#include <cmath>\nusing namespace std;\n' + source +
                '\nextern "C" double reference(double e,double c,double a,double w,double m){return GetGaussLorentzianIm(e,c,a,w,m);}\n')
            subprocess.run(['g++', '-shared', '-fPIC', '-O2', '-fno-fast-math', '-ffp-contract=off',
                            str(path / 'reference.cpp'), '-o', str(path / 'reference.so')], check=True)
            original = ctypes.CDLL(str(path / 'reference.so')).reference
            original.argtypes = [ctypes.c_double] * 5
            original.restype = ctypes.c_double
            for parameters in cases():
                status, value = evaluate(parameters)
                self.assertEqual(status, 0)
                self.assertEqual(value, original(*parameters))

if __name__ == '__main__':
    if '--wasm-payload' in sys.argv:
        payload = []
        for parameters in cases():
            status, value = evaluate(parameters)
            assert status == 0 and math.isfinite(value)
            payload.append(dict(parameters=parameters, expected=value))
        print(json.dumps(payload))
    else:
        unittest.main()
