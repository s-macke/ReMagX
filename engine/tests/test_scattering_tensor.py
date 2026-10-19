import ctypes
import hashlib
import math
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest

library = ctypes.CDLL(sys.argv.pop(1))
function = library.remagx_scattering_tensor
function.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.c_double, ctypes.c_double,
                     ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_double)]


def calculate(values, tensor=0, magnetic=1):
    factors = (ctypes.c_double * 4)(*values[:4])
    before = bytes(factors)
    output = (ctypes.c_double * 18)(*([-123] * 18))
    status = function(factors, *values[4:], tensor, magnetic, output)
    assert bytes(factors) == before
    return status, list(output)


class ScatteringTensorTest(unittest.TestCase):
    def test_independent_diagonal_and_magnetic_signs(self):
        status, values = calculate([3, 4, 5, 6, 0, 0])
        self.assertEqual(status, 0)
        self.assertEqual(values, [3, 4, -6, -5, 0, 0, 6, 5, 3, 4, 0, 0, 0, 0, 0, 0, 3, 4])
        status, values = calculate([3, 4, 5, 6, 90, 90])
        self.assertEqual(status, 0)
        self.assertEqual(values[4:6], [6, 5])
        self.assertEqual(values[12:14], [-6, -5])
        for magnetic in (0, 1):
            status, values = calculate([3, 4, 5, 6, 123, -45], 1, magnetic)
            self.assertEqual((status, values), (0, [3, 4, 0, 0, 0, 0, 0, 0, 3, 4, 0, 0, 0, 0, 0, 0, 5, 6]))
        self.assertEqual(calculate([3, 4, 5, 6, 123, -45], magnetic=0),
                         (0, [3, 4, 0, 0, 0, 0, 0, 0, 3, 4, 0, 0, 0, 0, 0, 0, 3, 4]))

    def test_invalid_input_is_atomic(self):
        for index in range(6):
            for invalid in (math.nan, math.inf, -math.inf):
                values = [1.] * 6
                values[index] = invalid
                self.assertEqual(calculate(values), (1, [-123] * 18))
        for tensor, magnetic in ((-1, 0), (2, 0), (0, -1), (0, 2)):
            self.assertEqual(calculate([1.] * 6, tensor, magnetic), (1, [-123] * 18))
        output = (ctypes.c_double * 18)(*([-123] * 18))
        factors = (ctypes.c_double * 4)(1, 2, 3, 4)
        self.assertEqual(function(None, 0, 0, 0, 0, output), 1)
        self.assertEqual(list(output), [-123] * 18)
        self.assertEqual(function(factors, 0, 0, 0, 0, None), 1)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original comparison not requested')
    def test_original_construction(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/MaterialConstantsHelper.cpp').read_text(encoding='latin1')
        method = source[source.index('void FillScatteringTensor('):source.index('void FillTensors(')]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(), '58eab719edde707f0819b91cc6f7bb175d862ef2d01a4baf3ea83372d121e572')
        scaffold = '''#include <complex>
#include <cmath>
#include <iostream>
#include <iomanip>
using namespace std;
enum TensorType { TENSORISOTROPIC, TENSORTETRAGONAL };
struct ElementLayerSystem { double f1,f2,f1m,f2m; struct { complex<double> a[3][3]; } F; };
'''
        main = '''int main(){ ElementLayerSystem s; double gamma,phi; int tensor,magnetic;
while(cin>>s.f1>>s.f2>>s.f1m>>s.f2m>>gamma>>phi>>tensor>>magnetic){
FillScatteringTensor(s,gamma,phi,magnetic,static_cast<TensorType>(tensor));
cout<<setprecision(17);for(auto& row:s.F.a)for(auto value:row)cout<<value.real()<<' '<<value.imag()<<' ';cout<<'\\n';}}
'''
        generator = random.Random(26023)
        cases = []
        for index in range(480):
            scale = (1e-12, 1, 1e12)[index % 3]
            values = [generator.uniform(-100, 100) * scale for _ in range(4)]
            values += [generator.uniform(-720, 720) for _ in range(2)]
            cases.append((values, index % 2, (index // 2) % 2))
        payload = '\n'.join(' '.join(map(str, [*values, tensor, magnetic])) for values, tensor, magnetic in cases) + '\n'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reference.cpp'
            binary = Path(directory) / 'reference'
            path.write_text(scaffold + method + main)
            subprocess.run(['g++', '-std=c++17', '-O2', '-ffp-contract=off', str(path), '-o', str(binary)], capture_output=True, check=True)
            rows = subprocess.run([str(binary)], input=payload, text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(rows), len(cases))
        for row, (values, tensor, magnetic) in zip(rows, cases):
            status, actual = calculate(values, tensor, magnetic)
            self.assertEqual(status, 0)
            reference = list(map(float, row.split()))
            self.assertEqual(len(reference), 18)
            for value, expected in zip(actual, reference):
                self.assertLessEqual(abs(value - expected), 1e-15 + 1e-10 * abs(expected))
        print('Original scattering tensors: 8,640 components matched.', flush=True)


if __name__ == '__main__':
    unittest.main()
