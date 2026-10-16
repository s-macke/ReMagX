import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest

library = ctypes.CDLL(sys.argv.pop(1))
class Profile(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ['center', 'width', 'delta_amplitude', 'beta_amplitude']]
Pointer = ctypes.POINTER(ctypes.c_double)
library.remagx_gaussian_profile.argtypes = [ctypes.POINTER(Profile), Pointer, ctypes.c_size_t, Pointer]
library.remagx_gaussian_spline_knots.argtypes = [ctypes.POINTER(Profile), ctypes.c_int, Pointer, Pointer]

def evaluate(profile, positions):
    points = (ctypes.c_double * len(positions))(*positions)
    output = (ctypes.c_double * (2 * len(positions)))(*([-123.] * (2 * len(positions))))
    before = bytes(profile), bytes(points)
    status = library.remagx_gaussian_profile(ctypes.byref(profile), points, len(positions), output)
    assert before == (bytes(profile), bytes(points))
    return status, list(output)

def knots(profile, intervals=4):
    count = max(0, intervals + 5)
    positions, values = [(ctypes.c_double * count)(*([-123.] * count)) for _ in range(2)]
    before = bytes(profile)
    status = library.remagx_gaussian_spline_knots(ctypes.byref(profile), intervals, positions, values)
    assert before == bytes(profile)
    return status, list(positions), list(values)

def profile_cases():
    generator = random.Random(26033)
    cases = []
    for number in range(240):
        center = generator.uniform(-100, 100)
        width = 0 if number % 11 == 0 else generator.uniform(-20, 20)
        delta = 0 if number % 7 == 0 else generator.uniform(-.1, .1)
        profile = Profile(center, width, delta, generator.uniform(-.1, .1))
        positions = [center + offset * width for offset in [-10, -6, -2, -.5, 0, .5, 2, 6, 10]]
        cases.append((profile, positions, [0, 1, 4, 16][number % 4]))
    return cases

class GaussianProfileTest(unittest.TestCase):
    def test_gaussian_shape_and_signed_width(self):
        profile = Profile(10, 2, .03, -.02)
        status, actual = evaluate(profile, [10, 12, 8, 22])
        self.assertEqual(status, 0)
        expected = [.03, -.02, .03 * math.exp(-.5), -.02 * math.exp(-.5),
                    .03 * math.exp(-.5), -.02 * math.exp(-.5), .03 * math.exp(-18), -.02 * math.exp(-18)]
        self.assertEqual(actual, expected)
        profile.width = -2
        self.assertEqual(evaluate(profile, [10, 12, 8, 22]), (0, expected))
        profile.width = 0
        self.assertEqual(evaluate(profile, [10, 12]), (0, [0]*4))

    def test_knots_and_zero_amplitude(self):
        profile = Profile(10, 2, .03, -.02)
        status, positions, values = knots(profile)
        self.assertEqual(status, 0)
        self.assertEqual(positions, [-2, 1, 4, 7, 10, 13, 16, 19, 22])
        self.assertEqual(values[4], 1)
        self.assertAlmostEqual(values[0], math.exp(-18), delta=1e-22)
        profile.delta_amplitude = 0
        self.assertEqual(knots(profile), (0, positions, [0]*9))
        profile.width = 0
        self.assertEqual(knots(profile), (0, [10]*9, [0]*9))
        profile.width = -2
        self.assertEqual(knots(profile)[1], positions[::-1])

    def test_invalid_and_late_numerical_errors_are_atomic(self):
        profile = Profile(0, 1, 1, 1)
        self.assertEqual(evaluate(profile, [0, math.nan]), (1, [-123]*4))
        profile.width = math.inf
        self.assertEqual(evaluate(profile, [0]), (1, [-123]*2))
        self.assertEqual(knots(profile), (1, [-123]*9, [-123]*9))
        profile.width = 1e308
        self.assertEqual(evaluate(profile, [0, 1e308]), (2, [-123]*4))
        self.assertEqual(knots(profile), (2, [-123]*9, [-123]*9))
        profile.width = 1
        self.assertEqual(knots(profile, -1), (1, [-123]*4, [-123]*4))
        sentinel = (ctypes.c_double * 2)(-123, -456)
        point = (ctypes.c_double * 1)(0)
        self.assertEqual(library.remagx_gaussian_profile(ctypes.byref(profile), point, ctypes.c_size_t(-1).value, sentinel), 3)
        self.assertEqual(list(sentinel), [-123, -456])
        self.assertEqual(library.remagx_gaussian_profile(None, point, 1, sentinel), 1)
        self.assertEqual(library.remagx_gaussian_spline_knots(ctypes.byref(profile), 2147483647, sentinel, sentinel), 1)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original comparison not requested')
    def test_original_gaussians_and_knots(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/CGaussFunc.h').read_text(encoding='latin1')
        self.assertEqual(hashlib.sha256(source.encode()).hexdigest(), '602ae8b0a3766fd5f36eff64734fd66f032289007d174ada841c0171a7e28bbf')
        # Use only the standalone Gaussian/spline class header; no NR routines
        # or legacy containers enter the temporary reference compilation.
        source = source.replace('#include"CVector.h"', '#include <vector>\ntemplate<class T> using CVector = std::vector<T>;')
        wrapper = '''#include <iostream>
#include <iomanip>
int main(){double center,width,delta,beta;int n,count;std::cout<<std::setprecision(17);
while(std::cin>>center>>width>>delta>>beta>>n>>count){CGaussFunc profile;profile.z=center;profile.Var=width;profile.delta=delta;profile.beta=beta;
for(int i=0;i<count;++i){double position;std::cin>>position;std::cout<<profile.DeltaGauss(position)<<' '<<profile.BetaGauss(position)<<' ';}
profile.BuildSpline(n);for(double x:profile.sf.x)std::cout<<x<<' ';for(double y:profile.sf.y)std::cout<<y<<' ';std::cout<<'\\n';}}
'''
        cases = profile_cases()
        payload = '\n'.join(' '.join(map(str, [profile.center, profile.width, profile.delta_amplitude,
            profile.beta_amplitude, intervals, len(positions), *positions])) for profile, positions, intervals in cases)
        with tempfile.TemporaryDirectory(prefix='remagx-gaussian-') as temporary:
            cpp, exe = Path(temporary) / 'reference.cpp', Path(temporary) / 'reference'
            cpp.write_text(source + wrapper)
            subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(cpp), '-o', str(exe)], check=True)
            lines = subprocess.run([str(exe)], input=payload, text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(lines), len(cases))
        comparisons = 0
        for (profile, positions, intervals), line in zip(cases, lines):
            status, amplitudes = evaluate(profile, positions)
            knot_status, coordinates, values = knots(profile, intervals)
            self.assertEqual((status, knot_status), (0, 0))
            actual, expected = amplitudes + coordinates + values, list(map(float, line.split()))
            self.assertEqual(len(actual), len(expected))
            for value, reference in zip(actual, expected):
                self.assertLessEqual(abs(value - reference), 1e-15 + 1e-10 * abs(reference))
                comparisons += 1
        print(f'Original Gaussian profiles and spline knots: {comparisons} values matched.')

if __name__ == '__main__':
    if '--wasm-payload' in sys.argv:
        payload = []
        for profile, positions, intervals in profile_cases():
            packed = [getattr(profile, name) for name, _ in Profile._fields_]
            status, values = evaluate(profile, positions)
            assert status == 0
            payload.append(dict(kind='gaussian', profile=packed, positions=positions, expected=values))
            status, coordinates, values = knots(profile, intervals)
            assert status == 0
            payload.append(dict(kind='knots', profile=packed, intervals=intervals, expected=coordinates + values))
        print(json.dumps(payload))
    else:
        unittest.main()
