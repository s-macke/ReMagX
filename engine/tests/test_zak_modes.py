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
Pointer = ctypes.POINTER(ctypes.c_double)
library.remagx_zak_modes.argtypes = [Pointer, Pointer] + [ctypes.c_double] * 5 + [Pointer] * 3

def evaluate(index, magnetic, angle, gamma, phi, wave, thickness):
    inputs = [(ctypes.c_double * 2)(*values) for values in [index, magnetic]]
    outputs = [(ctypes.c_double * size)(*([-123.] * size)) for size in [2, 32, 32]]
    before = [bytes(value) for value in inputs]
    status = library.remagx_zak_modes(*inputs, angle, gamma, phi, wave, thickness, *outputs)
    assert before == [bytes(value) for value in inputs]
    return status, [value for output in outputs for value in output]

class ZakModesTest(unittest.TestCase):
    def test_errors_are_atomic(self):
        for index, magnetic, angle, wave, thickness, expected in [
            ([0, 0], [0, 0], .2, .3, 20, 2),
            ([1, 0], [math.nan, 0], .2, .3, 20, 1),
            ([1, 0], [0, 0], math.inf, .3, 20, 1),
            ([.99, .01], [.001, 0], .2, .3, 1e308, 2)]:
            self.assertEqual(evaluate(index, magnetic, angle, .4, .5, wave, thickness), (expected, [-123.] * 66))
        self.assertEqual(library.remagx_zak_modes(None, None, 0, 0, 0, 0, 0, None, None, None), 1)

    def test_clamp_and_zero_thickness(self):
        args = ([.99, .002], [.001, .0001])
        self.assertEqual(evaluate(*args, -.2, .4, .5, .3, 20), evaluate(*args, 1e-4, .4, .5, .3, 20))
        status, values = evaluate(*args, .2, .4, .5, .3, 0)
        self.assertEqual(status, 0)
        self.assertEqual(values[34:], [-123.] * 32)

    def test_nonmagnetic_boundary_and_propagation(self):
        import cmath
        index = complex(.99, .002)
        status, values = evaluate([index.real, index.imag], [0, 0], .2, .4, .5, .3, 20)
        self.assertEqual(status, 0)
        root = cmath.sqrt(index * index - math.cos(.2) ** 2)
        normal = root / index
        expected = [1, 0, 0, normal * index, 0, normal, -index, 0,
                    1, 0, 0, -normal * index, 0, -normal, -index, 0]
        boundary = [complex(*values[i:i+2]) for i in range(2, 34, 2)]
        for actual, wanted in zip(boundary, expected):
            self.assertLessEqual(abs(actual - wanted), 1e-15 + 1e-10 * abs(wanted))
        forward = cmath.exp(-1j * .3 * index * normal * 20)
        propagation = [complex(*values[i:i+2]) for i in range(34, 66, 2)]
        for i, actual in enumerate(propagation):
            wanted = forward if i in [0, 5] else 1 / forward if i in [10, 15] else 0
            self.assertLessEqual(abs(actual - wanted), 1e-15 + 1e-10 * abs(wanted))

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original comparison not requested')
    def test_original(self):
        root = Path(os.environ['LEGACY_ROOT'])
        source = (root / 'shared/simul/CZak.h').read_text(encoding='latin1')
        method = source[source.index('template<class T>\nvoid inline SetMatrixZak'):source.index('template<class T>\nvoid CZak<T>::AddRoughness')]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(), 'b537aaf01a5e1e2482fbcd8a02dabe76ec922a0fa6950e1de8652687b7d547a2')
        source = (root / 'shared/CMatrix.h').read_text(encoding='latin1')
        setter = source[source.index('template<class T >\nvoid inline CMATRIX<T>::SetMatrixLine'):source.index('\n#endif')]
        self.assertEqual(hashlib.sha256(setter.encode()).hexdigest(), 'd75d436c1b97a8756cd5ac167300700eb18b02aac51dd23e6bf5f557c253372e')
        scaffold = '''#include <complex>
#include <cmath>
#include <iostream>
#include <iomanip>
using namespace std;
template<class T> struct CMATRIX {complex<T> a[4][4]{};
void SetMatrixLine(int, const complex<T>&, const complex<T>&, const complex<T>&, const complex<T>&);};
'''
        wrapper = '''int main(){double nr,ni,qr,qi,angle,gamma,phi,wave,thickness;cout<<setprecision(17);
while(cin>>nr>>ni>>qr>>qi>>angle>>gamma>>phi>>wave>>thickness){
CMATRIX<double> boundary,propagation;for(auto& row:propagation.a)for(auto& v:row)v={-123,-123};complex<double> root;
SetMatrixZak(propagation,boundary,root,angle,gamma,phi,wave,thickness,complex<double>(nr,ni),complex<double>(qr,qi));
cout<<root.real()<<' '<<root.imag()<<' ';
for(auto matrix:{boundary,propagation})for(auto& row:matrix.a)for(auto v:row)cout<<v.real()<<' '<<v.imag()<<' ';
cout<<'\\n';}}
'''
        generator = random.Random(26031)
        cases = []
        for number in range(160):
            index = [generator.uniform(.85, 1.1), generator.uniform(0, .02)]
            magnetic = [0, 0] if number % 4 == 0 else [generator.uniform(-.002, .002), generator.uniform(-.001, .001)]
            for angle in [-.01, 0, 1e-4, .02, .2, 1.]:
                cases.append((index, magnetic, angle, generator.uniform(-math.pi, math.pi),
                              generator.uniform(-math.pi, math.pi), generator.uniform(.1, 1), 0 if number % 5 == 0 else generator.uniform(-10, 100)))
        payload = '\n'.join(' '.join(map(str, [*a, *b, *rest])) for a, b, *rest in cases)
        with tempfile.TemporaryDirectory() as temporary:
            cpp = Path(temporary) / 'reference.cpp'; exe = Path(temporary) / 'reference'
            cpp.write_text(scaffold + setter + method + wrapper)
            subprocess.run(['c++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(cpp), '-o', str(exe)], check=True, capture_output=True)
            lines = subprocess.run([str(exe)], input=payload, text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(lines), len(cases))
        for case, line in zip(cases, lines):
            status, actual = evaluate(*case)
            self.assertEqual(status, 0)
            expected = list(map(float, line.split()))
            self.assertEqual(len(expected), 66)
            for value, reference in zip(actual, expected):
                self.assertLessEqual(abs(value - reference), 1e-15 + 1e-10 * abs(reference))
        print(f'Compared {len(cases) * 66} Zak mode components against original helper.')

if __name__ == '__main__':
    unittest.main()
