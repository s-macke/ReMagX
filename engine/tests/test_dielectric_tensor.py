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
class Layer(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('thickness', 'roughness', 'delta', 'beta', 'delta_magnetic', 'beta_magnetic', 'gamma', 'phi')]
function = library.remagx_dielectric_tensor
function.argtypes = [ctypes.POINTER(Layer), ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_int)]

def calculate(values, tensor=0, magnetic=1):
    layer = Layer(0, 0, *values)
    output = (ctypes.c_double * 18)(*([-123] * 18))
    kind = ctypes.c_int(-123)
    before = bytes(layer)
    status = function(ctypes.byref(layer), tensor, magnetic, output, ctypes.byref(kind))
    assert bytes(layer) == before
    return status, list(output), kind.value

class DielectricTensorTest(unittest.TestCase):
    def test_isotropic_magnetic_and_tetragonal_rules(self):
        status, values, kind = calculate([.01, .002, .001, .0001, 90, 90], magnetic=0)
        self.assertEqual((status, kind), (0, 0))
        diagonal = complex(.99, .002) ** 2
        self.assertEqual(values[0:2], [diagonal.real, diagonal.imag])
        self.assertEqual(values[0:2], values[8:10])
        self.assertEqual(values[0:2], values[16:18])
        self.assertTrue(all(values[index] == 0 for index in [2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15]))
        status, values, kind = calculate([.01, .002, .001, .0001, 90, 90])
        self.assertEqual((status, kind), (0, 1))
        self.assertEqual(values[4:6], [-value for value in values[12:14]])
        self.assertEqual(calculate([.01, .002, 0, 0, 0, 0])[2], 1)
        status, values, kind = calculate([.01, .002, .3, .1, 0, 0], tensor=1, magnetic=0)
        self.assertEqual((status, kind), (0, 1))
        expected = complex(.7, .1) ** 2
        self.assertEqual(values[16:18], [expected.real, expected.imag])

    def test_failures_leave_both_outputs_unchanged(self):
        for values, tensor, magnetic in [([math.nan, 0, 0, 0, 0, 0], 0, 1), ([0] * 6, 2, 1), ([0] * 6, 0, 2)]:
            self.assertEqual(calculate(values, tensor, magnetic), (1, [-123] * 18, -123))
        self.assertEqual(calculate([1e308, 0, 0, 0, 0, 0]), (2, [-123] * 18, -123))
        self.assertEqual(function(None, 0, 0, None, None), 1)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original tensor comparison not requested')
    def test_original_tensor_construction(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/MaterialConstantsHelper.cpp').read_text(encoding='latin1')
        method = source[source.index('void FillEpsilonTensor('):source.index('void FillScatteringTensor(')]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(), 'ac89e217efd1cfccc80b5c5012501df88f8d58e1d52db4c4f5e972e0ba0785d7')
        scaffold = '''#include <complex>
#include <cmath>
#include <iostream>
#include <iomanip>
using namespace std;
enum TensorType { TENSORISOTROPIC, TENSORTETRAGONAL };
enum { ISOTROPIC, ANISOTROPIC };
template<class T> struct CDeltaBeta { T delta,beta,deltam,betam; int epsilontype; struct { complex<T> a[3][3]; } epsilon; };
'''
        main = '''int main(){ CDeltaBeta<double> s; double gamma,phi; int tensor,magnetic;
while(cin>>s.delta>>s.beta>>s.deltam>>s.betam>>gamma>>phi>>tensor>>magnetic){
FillEpsilonTensor(s,gamma,phi,magnetic,static_cast<TensorType>(tensor));
cout<<s.epsilontype<<setprecision(17);for(auto& row:s.epsilon.a)for(auto value:row)cout<<' '<<value.real()<<' '<<value.imag();cout<<'\\n';}}
'''
        generator = random.Random(26021)
        cases = []
        for index in range(240):
            values = [generator.uniform(-.1, .1) for _ in range(4)] + [generator.uniform(-720, 720) for _ in range(2)]
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
            status, actual, kind = calculate(values, tensor, magnetic)
            reference = row.split()
            self.assertEqual((status, kind), (0, int(reference[0])))
            for value, expected in zip(actual, map(float, reference[1:])):
                self.assertLessEqual(abs(value-expected), 1e-15 + 1e-10 * abs(expected))
        print('Original dielectric tensors: 4,320 components and 240 classifications matched.', flush=True)

if __name__ == '__main__': unittest.main()
