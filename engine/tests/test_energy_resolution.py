import ctypes
import json
import math
from pathlib import Path
import random
import subprocess
import sys
import unittest

library = ctypes.CDLL(sys.argv.pop(1))
class Intensity(ctypes.Structure):
    _fields_ = [('beam1', ctypes.c_double), ('beam2', ctypes.c_double)]
function = library.remagx_energy_resolution
function.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.POINTER(Intensity), ctypes.c_size_t,
                     ctypes.c_double, ctypes.POINTER(Intensity)]
function.restype = ctypes.c_int

def calculate(energies, raw, width):
    count = len(energies)
    coordinates = (ctypes.c_double * count)(*energies)
    values = (Intensity * count)(*(Intensity(*raw[index:index+2]) for index in range(0, len(raw), 2)))
    output = (Intensity * count)(*(Intensity(-123, -456) for _ in energies))
    before = bytes(coordinates), bytes(values)
    status = function(coordinates, values, count, width, output)
    assert before == (bytes(coordinates), bytes(values))
    return status, [value for row in output for value in (row.beam1, row.beam2)]

class EnergyResolutionTest(unittest.TestCase):
    def test_threshold_and_constant_single_point(self):
        raw = [1, 2, 3, 4]
        for width in [0, 9e-11]:
            self.assertEqual(calculate([1, 2], raw, width), (0, raw))
        status, result = calculate([100], [2, 4], 1e-10)
        self.assertEqual(status, 0)
        self.assertAlmostEqual(result[0], 2, places=13)
        self.assertAlmostEqual(result[1], 4, places=13)
        self.assertEqual(calculate([-10], [2, 4], 1), (0, [0, 0]))
        status, result = calculate([0], [2, 4], 1)
        self.assertEqual(status, 0)
        # Nine positive nodes plus the central weight, with no renormalization.
        self.assertAlmostEqual(result[0], 1 + .124861419919597, places=13)

    def test_reviewed_interpolation_reference(self):
        randomizer = random.Random(26020)
        cases = []
        for index in range(120):
            count = 1 + index % 20
            energies = sorted(randomizer.choice(range(1, 50)) for _ in range(count))
            if index % 3 == 0: energies.reverse()
            if index % 7 == 0: randomizer.shuffle(energies)
            cases.append(dict(qz=energies, raw=[randomizer.uniform(-2, 5) for _ in range(count * 2)],
                              width=[1e-10, .1, 1, 20][index % 4], fast=True, dichroic=True))
        runner = Path(__file__).with_name('compare_resolution.mjs')
        reference = json.loads(subprocess.run(['node', '--experimental-strip-types', str(runner)],
            input=json.dumps(cases), text=True, capture_output=True, check=True).stdout)
        compared = 0
        for case, expected in zip(cases, reference):
            status, actual = calculate(case['qz'], case['raw'], case['width'])
            self.assertEqual(status, 0)
            for value, target in zip(actual, expected['values']):
                self.assertLessEqual(abs(value-target), 1e-15 + 1e-10 * abs(target))
                compared += 1
        print(f'Energy convolution: {compared} reviewed interpolation comparisons', flush=True)

    def test_invalid_and_late_failure_preserve_output(self):
        sentinel = [-123, -456, -123, -456]
        for energy, raw, width in [([1, math.nan], [1, 2, 3, 4], 1),
                ([1, 2], [1, 2, 3, math.inf], 1), ([1, 2], [1, 2, 3, 4], -1)]:
            self.assertEqual(calculate(energy, raw, width), (1, sentinel))
        self.assertEqual(calculate([1, 2], [1, 2, 3, 4], 1e308), (2, sentinel))
        self.assertEqual(function(None, None, 0, 1, None), 1)

if __name__ == '__main__': unittest.main()
