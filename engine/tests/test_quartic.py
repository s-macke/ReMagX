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
function = library.remagx_quartic_roots
function.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double)]

def calculate(coefficients):
    values = [part for value in map(complex, coefficients) for part in (value.real, value.imag)]
    source = (ctypes.c_double * 10)(*values)
    output = (ctypes.c_double * 8)(*([-123] * 8))
    before = bytes(source)
    status = function(source, output)
    assert bytes(source) == before
    return status, list(output)

def cases():
    yield [1, 0, 0, 0, 0]
    yield [1, 0, -5, 0, 4]
    yield [1, 0, 0, 1, 0] # zero resolvent-linear branch
    yield [1, 0, -2, 0, 1]
    generator = random.Random(26022)
    for index in range(240):
        coefficients = [complex(generator.uniform(.5, 2), generator.uniform(-1, 1))]
        for _ in range(4):
            root = complex(generator.uniform(-2, 2), generator.uniform(-2, 2))
            expanded = [0j] * (len(coefficients) + 1)
            for position, coefficient in enumerate(coefficients):
                expanded[position] += coefficient
                expanded[position + 1] -= coefficient * root
            coefficients = expanded
        if index % 4 == 0: coefficients[1] = coefficients[3] = 0
        yield coefficients

class QuarticTest(unittest.TestCase):
    def test_analytic_special_cases(self):
        for coefficients in list(cases())[:4]:
            status, values = calculate(coefficients)
            self.assertEqual(status, 0)
            for index in range(4):
                root = complex(*values[index*2:index*2+2])
                residual, scale = 0j, 0.0
                for coefficient in coefficients:
                    residual = residual * root + coefficient
                    scale = scale * abs(root) + abs(coefficient)
                self.assertLessEqual(abs(residual), 1e-15 + 1e-10 * scale)
        self.assertEqual(calculate([1, 0, -5, 0, 4])[1], [2, 0, 1, 0, -1, 0, -2, 0])

    def test_preserved_general_quartic_limitation(self):
        # The private comparison below checks every returned root against the
        # original, without exclusions. General mathematical correctness is a
        # separate diagnostic: legacy refinement does not always converge.
        bad, worst = 0, 0.0
        for case, coefficients in enumerate(cases()):
            status, values = calculate(coefficients)
            self.assertEqual(status, 0)
            largest = 0.0
            for index in range(4):
                root = complex(*values[index*2:index*2+2])
                residual, scale = 0j, 0.0
                for coefficient in coefficients:
                    residual = residual * root + coefficient
                    scale = scale * abs(root) + abs(coefficient)
                largest = max(largest, abs(residual) / (1 + scale))
            bad += largest > 1e-10
            worst = max(worst, largest)
            if case == 5:
                self.assertAlmostEqual(largest, .44375151676947683, places=12)
        print(f'Legacy quartic diagnostic: {bad}/244 cases exceed 1e-10 scaled residual; maximum {worst:.17g}.', flush=True)

    def test_invalid_inputs_and_overflow_are_atomic(self):
        for coefficients in [[0, 1, 2, 3, 4], [1, math.nan, 2, 3, 4]]:
            self.assertEqual(calculate(coefficients), (1, [-123] * 8))
        self.assertEqual(calculate([1, 1e308, 1e308, 1e308, 1e308]), (2, [-123] * 8))
        self.assertEqual(function(None, None), 1)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original quartic comparison not requested')
    def test_original_root_order_and_values(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/simul/CVisnovsky.h').read_text(encoding='latin1')
        method = source[source.index('template <class T>\nvoid SolvePolynomial('):source.index('template<class T>\nvoid inline SetMatrixTetragonal')]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(), 'c68841ed096a05a175ef633db8f619cd13dbe956f84732c38e8c39d91effa1c6')
        scaffold = '#include <complex>\n#include <vector>\n#include <iostream>\n#include <iomanip>\nusing namespace std;\n'
        main = '''int main(){double real,imag;while(cin>>real>>imag){complex<double> coefficients[5];coefficients[0]={real,imag};
for(int i=1;i<5;++i){cin>>real>>imag;coefficients[i]={real,imag};}vector<complex<double>> roots;
SolvePolynomial(coefficients[0],coefficients[1],coefficients[2],coefficients[3],coefficients[4],roots);
cout<<setprecision(17);for(auto root:roots)cout<<root.real()<<' '<<root.imag()<<' ';cout<<'\\n';}}
'''
        inputs = list(cases())
        payload = '\n'.join(' '.join(str(part) for value in map(complex, coefficients) for part in (value.real, value.imag)) for coefficients in inputs) + '\n'
        with tempfile.TemporaryDirectory() as directory:
            path, binary = Path(directory) / 'reference.cpp', Path(directory) / 'reference'
            path.write_text(scaffold + method + main)
            subprocess.run(['g++', '-std=c++17', '-O2', '-ffp-contract=off', str(path), '-o', str(binary)], capture_output=True, check=True)
            rows = subprocess.run([str(binary)], input=payload, text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(rows), len(inputs))
        for row, coefficients in zip(rows, inputs):
            expected = list(map(float, row.split()))
            self.assertEqual(len(expected), 8)
            status, actual = calculate(coefficients)
            self.assertEqual(status, 0)
            for value, target in zip(actual, expected):
                self.assertLessEqual(abs(value-target), 1e-15 + 1e-10 * abs(target))
        print(f'Original quartic routine: {len(inputs)*8} components matched in legacy root order.', flush=True)

if __name__ == '__main__': unittest.main()
