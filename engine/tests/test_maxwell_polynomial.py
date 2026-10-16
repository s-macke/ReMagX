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
for name in ('remagx_maxwell_polynomial', 'remagx_maxwell_roots'):
    getattr(library, name).argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.c_double, ctypes.POINTER(ctypes.c_double)]

def evaluate(tensor, angle, roots=False):
    source = (ctypes.c_double * 18)(*tensor)
    output = (ctypes.c_double * (8 if roots else 10))(*([-123] * (8 if roots else 10)))
    before = bytes(source)
    status = getattr(library, 'remagx_maxwell_roots' if roots else 'remagx_maxwell_polynomial')(source, angle, output)
    assert bytes(source) == before
    return status, list(output)

class Layer(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('thickness', 'roughness', 'delta', 'beta', 'delta_magnetic', 'beta_magnetic', 'gamma', 'phi')]
library.remagx_dielectric_tensor.argtypes = [ctypes.POINTER(Layer), ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_int)]

def cases():
    generator = random.Random(26023)
    for index in range(120):
        layer = Layer(0, 0, generator.uniform(.0001, .02), generator.uniform(.00001, .003),
            generator.uniform(-.001, .001), generator.uniform(-.0001, .0001),
            generator.uniform(-180, 180), generator.uniform(-180, 180))
        tensor = (ctypes.c_double * 18)()
        kind = ctypes.c_int()
        assert library.remagx_dielectric_tensor(ctypes.byref(layer), 0, 1, tensor, ctypes.byref(kind)) == 0
        for angle in [0, .01, .2, 1.0]: yield list(tensor), angle

class MaxwellPolynomialTest(unittest.TestCase):
    def test_isotropic_polynomial_and_errors(self):
        tensor = [0.0] * 18
        for index in [0, 8, 16]: tensor[index] = 1
        status, coefficients = evaluate(tensor, 0)
        self.assertEqual((status, coefficients), (0, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
        self.assertEqual(evaluate(tensor, 0, True), (0, [0] * 8))
        self.assertEqual(evaluate(tensor, math.nan), (1, [-123] * 10))
        tensor[0] = math.nan
        self.assertEqual(evaluate(tensor, .1, True), (1, [-123] * 8))
        self.assertEqual(evaluate([1e308] * 18, .1), (2, [-123] * 10))

    def test_generated_optical_tensor_residual_diagnostics(self):
        bad, worst = 0, 0.0
        for tensor, angle in cases():
            status, packed = evaluate(tensor, angle)
            self.assertEqual(status, 0)
            status, roots = evaluate(tensor, angle, True)
            self.assertEqual(status, 0)
            coefficients = [complex(*packed[index:index+2]) for index in range(0, 10, 2)]
            largest = 0.0
            for index in range(0, 8, 2):
                root = complex(*roots[index:index+2])
                residual, scale = 0j, 0.0
                for coefficient in coefficients:
                    residual = residual * root + coefficient
                    scale = scale * abs(root) + abs(coefficient)
                largest = max(largest, abs(residual) / (1 + scale))
            bad += largest > 1e-10
            worst = max(worst, largest)
        print(f'Generated magnetic Maxwell polynomial diagnostic: {bad}/480 cases above 1e-10 scaled residual; max {worst:.17g}.', flush=True)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original Maxwell comparison not requested')
    def test_original_polynomial_and_roots(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/simul/CVisnovsky.h').read_text(encoding='latin1')
        method = source[source.index('template <class T>\nvoid SolvePolynomial('):source.index('template<class T>\nvoid inline SetMatrixTetragonal')]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(), 'c68841ed096a05a175ef633db8f619cd13dbe956f84732c38e8c39d91effa1c6')
        branch = source[source.index('void inline SetMatrixAnisotropic('):]
        start = branch.index('   SolvePolynomial<T>(')
        expression = branch[start:branch.index('   );', start) + len('   );')]
        self.assertEqual(hashlib.sha256(expression.encode()).hexdigest(), '01889a4f29c1e4eae10cbfc016af1532e0269325029972b013a5c53641fd1d96')
        scaffold = '#include <complex>\n#include <vector>\n#include <cmath>\n#include <iostream>\n#include <iomanip>\nusing namespace std;\n'
        wrapper = '''void Capture(complex<double> a,complex<double> b,complex<double> c,complex<double> d,complex<double> e,vector<complex<double>>& roots){
for(auto value:{a,b,c,d,e})cout<<value.real()<<' '<<value.imag()<<' ';
SolvePolynomial(a,b,c,d,e,roots);for(auto value:roots)cout<<value.real()<<' '<<value.imag()<<' ';cout<<'\\n';}
int main(){double angle;cout<<setprecision(17);while(cin>>angle){struct { complex<double> a[3][3]; } e;
for(auto& row:e.a)for(auto& value:row){double real,imag;cin>>real>>imag;value={real,imag};}
vector<complex<double>> roots;double ky=cos(angle);
'''
        inputs = list(cases())
        payload = '\n'.join(' '.join(map(str, [angle, *tensor])) for tensor, angle in inputs) + '\n'
        with tempfile.TemporaryDirectory() as directory:
            path, binary = Path(directory) / 'reference.cpp', Path(directory) / 'reference'
            path.write_text(scaffold + method + wrapper + expression.replace('SolvePolynomial<T>', 'Capture') + '}}')
            subprocess.run(['g++', '-std=c++17', '-O2', '-ffp-contract=off', str(path), '-o', str(binary)], capture_output=True, check=True)
            rows = subprocess.run([str(binary)], input=payload, text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(rows), len(inputs))
        for row, (tensor, angle) in zip(rows, inputs):
            expected = list(map(float, row.split()))
            self.assertEqual(len(expected), 18)
            actual = evaluate(tensor, angle)[1] + evaluate(tensor, angle, True)[1]
            for value, target in zip(actual, expected):
                self.assertLessEqual(abs(value-target), 1e-15 + 1e-10 * abs(target))
        print('Original anisotropic Maxwell branch: 4,800 coefficient and 3,840 root components matched.', flush=True)

if __name__ == '__main__': unittest.main()
