import cmath
import ctypes
import math
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest

library_path = sys.argv.pop(1)


class Layer(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('thickness', 'roughness', 'delta', 'beta', 'delta_magnetic', 'beta_magnetic', 'gamma_degrees', 'phi_degrees')]


class Beam(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('sigma_real', 'sigma_imaginary', 'pi_real', 'pi_imaginary')]


class Point(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('angle_radians', 'vacuum_wave_number', 'magnetization')]


library = ctypes.CDLL(library_path)
library.remagx_parratt.argtypes = [ctypes.POINTER(Layer), ctypes.c_size_t, ctypes.POINTER(Point), ctypes.c_size_t, ctypes.POINTER(Beam), ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_double)]
library.remagx_parratt.restype = ctypes.c_int


def calculate(layers, points, beam=(1, 0, 0, 0), tensor=0, analyzer=0):
    layer_array = (Layer * len(layers))(*(Layer(*layer) for layer in layers))
    point_array = (Point * len(points))(*(Point(*point) for point in points))
    polarization = Beam(*beam)
    output = (ctypes.c_double * len(points))(*([-123.0] * len(points)))
    before = bytes(layer_array), bytes(point_array), bytes(polarization)
    status = library.remagx_parratt(layer_array, len(layers), point_array, len(points), ctypes.byref(polarization), tensor, analyzer, output)
    if before != (bytes(layer_array), bytes(point_array), bytes(polarization)):
        raise AssertionError('API mutated its input')
    return status, list(output)


class NativeParrattTest(unittest.TestCase):
    def test_fresnel_and_complex_polarization(self):
        layers = [(0, 0, 0.01, 0.002, 0, 0, 90, 90), (0, 0, 0, 0, 0, 0, 90, 90)]
        angle = 0.2
        index = complex(0.99, 0.002)
        lower = cmath.sqrt(index * index - math.cos(angle)**2)
        upper = cmath.sqrt(1 - math.cos(angle)**2)
        sigma = abs((upper - lower) / (upper + lower))**2
        pi = abs((index*index*upper - lower) / (index*index*upper + lower))**2
        for analyzer, expected in [(0, .25*sigma + pi), (1, .25*sigma), (2, pi)]:
            status, values = calculate(layers, [(angle, 1, 0)], (.3, .4, .6, .8), analyzer=analyzer)
            self.assertEqual(status, 0)
            self.assertLessEqual(abs(values[0] - expected), 1e-15 + 1e-10*abs(expected))

    def test_failures_leave_output_untouched(self):
        layers = [(0, 0, 0.01, 0.002, 0, 0, 90, 90), (0, 0, 0, 0, 0, 0, 90, 90)]
        for points in [[(.1, 1, 0), (math.nan, 1, 0)], [(.1, 0, 0)]]:
            status, values = calculate(layers, points)
            self.assertEqual(status, 1)
            self.assertEqual(values, [-123.0] * len(points))
        for tensor, analyzer in [(2, 0), (0, -1), (0, 3)]:
            self.assertEqual(calculate(layers, [(.1, 1, 0)], tensor=tensor, analyzer=analyzer), (1, [-123.0]))
        explosive = [(0, 0, 1e308, 1e308, 0, 0, 90, 90), layers[1]]
        self.assertEqual(calculate(explosive, [(.1, 1, 0)]), (2, [-123.0]))
        magnetic_layers = [(0, 0, .01, .002, 1, 0, 90, 90), layers[1]]
        self.assertEqual(calculate(magnetic_layers, [(.1, 1, 0), (.1, 1, 1e308)]), (2, [-123.0, -123.0]))
        self.assertEqual(library.remagx_parratt(None, 2, None, 1, None, 0, 0, None), 1)

    def test_zero_contrast_and_partition_invariance(self):
        ambient = (0, 0, 0, 0, 0, 0, 90, 90)
        substrate = (0, 0, .01, .002, 0, 0, 90, 90)
        self.assertEqual(calculate([ambient, ambient], [(0, 1, 0), (.2, 1, 0)]), (0, [0.0, 0.0]))
        direct = calculate([substrate, ambient], [(.1, 1, 0)])[1][0]
        split = calculate([substrate, (50, *substrate[1:]), ambient], [(.1, 1, 0)])[1][0]
        self.assertLessEqual(abs(direct - split), 1e-15 + 1e-10*abs(direct))


@unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private legacy comparison not requested')
class LegacyComparisonTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/golden/legacy'))
        from build_reference import build
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        cls.reference = build(os.environ['LEGACY_ROOT'], Path(cls.directory.name) / 'reference')

    def test_prepared_stacks_match_original_all_parratt_branches(self):
        generator = random.Random(26017)
        comparisons = 0
        for case in range(120):
            tensor = case % 2
            analyzer = case % 3
            beam = generator.choice([(1, 0, 0, 0), (0, 0, 1, 0), (.3, .4, .6, .8), (0, math.sqrt(.5), math.sqrt(.5), 0)])
            layers = [(generator.uniform(0, 150), generator.choice([0, generator.uniform(0, 8)]),
                       generator.uniform(-.002, .015), generator.uniform(.001, .003), generator.uniform(-.0003, .0003),
                       generator.uniform(-.0001, .0001), generator.uniform(-180, 180), generator.uniform(-180, 180))
                      for _ in range(generator.randint(2, 18))]
            layers[-1] = (0, 0, 0, 0, 0, 0, 90, 90)
            points = [(angle, wave, magnetic) for angle in [-.03, 0, 1e-8, .005, .1, math.pi/2]
                      for wave in [.05, 1] for magnetic in [-1, 0, 1]]
            payload = f'{len(layers)} {len(points)} {tensor} {analyzer}\n'
            payload += ' '.join(map(str, beam)) + '\n'
            payload += '\n'.join(' '.join(map(str, row)) for row in [*layers, *points]) + '\n'
            reference = subprocess.run([self.reference], input=payload, text=True, capture_output=True, check=True)
            expected = list(map(float, reference.stdout.splitlines()))
            status, actual = calculate(layers, points, beam, tensor, analyzer)
            self.assertEqual(status, 0, f'synthetic case {case}')
            self.assertEqual(len(expected), len(actual))
            for index, (value, target) in enumerate(zip(actual, expected)):
                self.assertTrue(math.isfinite(value))
                self.assertLessEqual(abs(value-target), 1e-15 + 1e-10*abs(target), f'synthetic case {case}, point {index}')
                comparisons += 1
        self.assertEqual(comparisons, 4320)


if __name__ == '__main__':
    unittest.main()
