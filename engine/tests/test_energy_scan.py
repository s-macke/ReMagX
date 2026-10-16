import ctypes
import math
import sys
import unittest
from parratt_cases import synthetic_cases

library = ctypes.CDLL(sys.argv.pop(1))
class Layer(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('thickness', 'roughness', 'delta', 'beta', 'delta_magnetic', 'beta_magnetic', 'gamma', 'phi')]
class Beam(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('sr', 'si', 'pr', 'pi')]
class Intensity(ctypes.Structure):
    _fields_ = [('plus', ctypes.c_double), ('minus', ctypes.c_double)]
P = ctypes.POINTER
scan = library.remagx_parratt_energy_scan
scan.argtypes = [P(Layer), ctypes.c_size_t, P(ctypes.c_double), P(ctypes.c_double), P(ctypes.c_int), ctypes.c_size_t,
    P(Beam), P(Beam), ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_double, ctypes.c_double, P(Intensity)]
point = library.remagx_parratt_qz_resolution
point.argtypes = [P(Layer), ctypes.c_size_t, P(ctypes.c_double), ctypes.c_size_t, ctypes.c_double,
    P(Beam), P(Beam), ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_double, ctypes.c_int, P(Intensity)]
convolve = library.remagx_energy_resolution
convolve.argtypes = [P(ctypes.c_double), P(Intensity), ctypes.c_size_t, ctypes.c_double, P(Intensity)]

class EnergyScanTest(unittest.TestCase):
    def test_prepared_scan_matches_per_energy_evaluation_and_convolution(self):
        comparisons = 0
        for case, source in enumerate(synthetic_cases()):
            count = 4
            layers = source['layers']
            stacks = [[tuple(value * (1 + index * .01) if field in (2, 3, 4, 5) else value
                              for field, value in enumerate(layer)) for layer in layers] for index in range(count)]
            packed = (Layer * (count * len(layers)))(*(Layer(*layer) for stack in stacks for layer in stack))
            energies = (ctypes.c_double * count)(640, 645, 642, 650)
            qz = (ctypes.c_double * count)(-.001, .001, .03, .08)
            enabled = (ctypes.c_int * count)(1, case % 2, 1, 1)
            first, second = Beam(*source['beam']), Beam(.3, .4, .6, .8)
            angular = [0, 1e-11, .002][case % 3]
            width = [0, 1e-11, 1e-10, .5][case % 4]
            for mode in [0, 1]:
                raw, expected, actual = (Intensity * count)(), (Intensity * count)(), (Intensity * count)()
                for index in range(count):
                    raw[index] = Intensity(1, mode)
                    if not enabled[index]: continue
                    stack = (Layer * len(layers))(*(Layer(*layer) for layer in stacks[index]))
                    coordinate = ctypes.c_double(qz[index])
                    self.assertEqual(point(stack, len(layers), ctypes.byref(coordinate), 1, energies[index],
                        ctypes.byref(first), ctypes.byref(second), source['tensor'], source['analyzer'], 1, mode, angular, 0, ctypes.byref(raw[index])), 0)
                self.assertEqual(convolve(energies, raw, count, width, expected), 0)
                snapshot = [bytes(item) for item in (packed, energies, qz, enabled, first, second)]
                self.assertEqual(scan(packed, len(layers), energies, qz, enabled, count, ctypes.byref(first), ctypes.byref(second),
                    source['tensor'], source['analyzer'], 1, mode, angular, width, actual), 0)
                self.assertEqual(snapshot, [bytes(item) for item in (packed, energies, qz, enabled, first, second)])
                self.assertEqual(bytes(actual), bytes(expected))
                comparisons += count * 2
        print(f'Native prepared energy scans: {comparisons} intensity comparisons', flush=True)

    def test_late_errors_are_atomic_and_disabled_points_skip_layers(self):
        layers = (Layer * 4)(Layer(0, 0, .01, .002, 0, 0, 90, 90), Layer(), Layer(), Layer())
        energies = (ctypes.c_double * 2)(640, 640)
        qz = (ctypes.c_double * 2)(.03, 1e4)
        enabled = (ctypes.c_int * 2)(1, 1)
        beam = Beam(1, 0, 0, 0)
        output = (Intensity * 2)(Intensity(-123, -456), Intensity(-123, -456))
        initial = bytes(output)
        def run(): return scan(layers, 2, energies, qz, enabled, 2, ctypes.byref(beam), None, 0, 0, 0, 0, 0, 0, output)
        self.assertEqual(run(), 4)
        self.assertEqual(bytes(output), initial)
        enabled[1] = 2
        self.assertEqual(run(), 1)
        self.assertEqual(bytes(output), initial)
        enabled[1] = 0
        layers[2].delta = math.nan
        self.assertEqual(run(), 0)
        self.assertEqual((output[1].plus, output[1].minus), (1, 0))
        self.assertEqual(scan(None, 0, None, None, None, 0, None, None, 0, 0, 0, 0, 0, 0, None), 1)

if __name__ == '__main__': unittest.main()
