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
library.remagx_classify_tensor.argtypes = [Pointer, ctypes.c_double, ctypes.POINTER(ctypes.c_int)]
library.remagx_analytic_modes.argtypes = [ctypes.c_int, Pointer, Pointer, ctypes.c_double, ctypes.c_double, ctypes.c_double, Pointer, Pointer, Pointer]

library.remagx_matrix_modes.argtypes = [ctypes.c_int, Pointer, Pointer, ctypes.c_double, ctypes.c_double, ctypes.c_double, ctypes.c_double, Pointer, Pointer, Pointer]

def classify(tensor, epsilon):
    result = ctypes.c_int(-123)
    status = library.remagx_classify_tensor((ctypes.c_double * 18)(*tensor), epsilon, ctypes.byref(result))
    return status, result.value

def evaluate(kind, tensor, index, angle, wave, thickness, epsilon=None):
    source = (ctypes.c_double * 18)(*tensor)
    refractive = (ctypes.c_double * 2)(*index)
    outputs = [(ctypes.c_double * count)(*([-123] * count)) for count in [8, 32, 32]]
    before = bytes(source), bytes(refractive)
    if epsilon is None:
        status = library.remagx_analytic_modes(kind, source, refractive, angle, wave, thickness, *outputs)
    else:
        status = library.remagx_matrix_modes(kind, source, refractive, epsilon, angle, wave, thickness, *outputs)
    assert before == (bytes(source), bytes(refractive))
    return status, [value for output in outputs for value in output]

def cases():
    generator = random.Random(26024)
    for number in range(120):
        tensor = [0.] * 18
        for position in [0, 8, 16]:
            tensor[position] = generator.uniform(.8, 1.1)
            tensor[position + 1] = generator.uniform(0, .01)
        if number % 3 == 0: tensor[8:10] = tensor[16:18] = tensor[:2]
        if number % 3 == 1: tensor[2] = .001
        index = [generator.uniform(.9, 1.1), generator.uniform(0, .01)]
        for kind in [0, 2]:
            for angle in [-.01, 0, 1e-4, .2]:
                yield kind, tensor, index, angle, .3, 0 if number % 4 == 0 else 20

class AnalyticModesTest(unittest.TestCase):
    def test_classifier_boundaries(self):
        tensor = [0.] * 18
        for position in [0, 8, 16]: tensor[position] = 1
        for epsilon, expected in [(-1, 1), (0, 1), (1e-8, 0)]:
            self.assertEqual(classify(tensor, epsilon), (0, expected))
        tensor[2] = .125
        self.assertEqual(classify(tensor, .125), (0, 1))
        self.assertEqual(classify(tensor, math.nextafter(.125, math.inf)), (0, 0))
        tensor[2] = 0; tensor[8] = 1.125
        self.assertEqual(classify(tensor, .125), (0, 2))
        self.assertEqual(classify(tensor, math.nextafter(.125, math.inf)), (0, 0))
        self.assertEqual(classify(tensor, math.nan), (1, -123))
        tensor[0] = math.inf
        self.assertEqual(classify(tensor, 1), (1, -123))

    def test_errors_and_zero_thickness(self):
        tensor = [0.] * 18
        for position in [0, 8, 16]: tensor[position] = 1
        for kind, index, angle, status in [(1, [1, 0], 0, 1), (0, [0, 0], 0, 2),
                                           (0, [1, 0], math.nan, 1), (2, [1, 0], math.inf, 1)]:
            self.assertEqual(evaluate(kind, tensor, index, angle, .3, 0), (status, [-123] * 72))
        for kind in [0, 2]:
            status, output = evaluate(kind, tensor, [1, 0], 0, .3, 0)
            self.assertEqual(status, 0)
            self.assertEqual(output[40:], [1 if position in [0, 10, 20, 30] else 0 for position in range(32)])
        self.assertEqual(evaluate(0, tensor, [1, 0], -.1, .3, 10), evaluate(0, tensor, [1, 0], 1e-4, .3, 10))
        tensor[16] = 0
        self.assertEqual(evaluate(2, tensor, [1, 0], .1, .3, 0), (2, [-123] * 72))

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original mode comparison not requested')
    def test_original_shortcuts_and_classification(self):
        self.compare_original(False)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original mode comparison not requested')
    def test_original_general_dispatch(self):
        self.compare_original(True)

    def test_dispatch_and_degenerate_errors(self):
        tensor = [0.] * 18
        for position in [0, 8, 16]: tensor[position] = 1
        self.assertEqual(evaluate(1, tensor, [2, 0], .2, .3, 10, 1e-8),
                         evaluate(0, tensor, [1, 0], .2, .3, 10))
        self.assertEqual(evaluate(1, tensor, [1, 0], 0, .3, 0, 0), (2, [-123] * 72))
        self.assertEqual(evaluate(2, tensor, [1, 0], .2, .3, 0, 1e-8), (1, [-123] * 72))
        tensor[0] = math.nan
        self.assertEqual(evaluate(1, tensor, [1, 0], .2, .3, 0, 1e-8), (1, [-123] * 72))
        self.assertEqual(evaluate(0, tensor, [1, 0], .2, .3, 0, 1e-8)[0], 0)

    def compare_original(self, dispatch):
        root = Path(os.environ['LEGACY_ROOT'])
        source = (root / 'shared/simul/CVisnovsky.h').read_text(encoding='latin1')
        methods = source[source.index('template<class T>\nvoid inline SetMatrixTetragonal'):source.index('template<class T>\ninline void SetMaxwellMatrix')]
        self.assertEqual(hashlib.sha256(methods.encode()).hexdigest(), '3a04d491b0026dc86ec45b5e8733541fe17ce8023b15b8638955de29125facee')
        if dispatch:
            quartic = source[source.index('template <class T>\nvoid SolvePolynomial('):source.index('template<class T>\nvoid inline SetMatrixTetragonal')]
            self.assertEqual(hashlib.sha256(quartic.encode()).hexdigest(), 'c68841ed096a05a175ef633db8f619cd13dbe956f84732c38e8c39d91effa1c6')
            general = source[source.index('template<class T>\nvoid inline SetMatrixAnisotropic'):source.index('template<class T>\nvoid CVisnovsky<T>::AddRoughness')]
            self.assertEqual(hashlib.sha256(general.encode()).hexdigest(), '3d3bf323746596866736078eda967bcda3913069f32be97d6563350cb5cfa8b8')
            methods = quartic + methods + general
        source = (root / 'shared/MaterialConstants.h').read_text(encoding='latin1')
        classification = source[source.index('static EPSILONTYPE GetMatrixType'):source.index('\n};', source.index('static EPSILONTYPE GetMatrixType'))]
        self.assertEqual(hashlib.sha256(classification.encode()).hexdigest(), 'd126d2231fa3d8b068b4960e9efdb6edf9d8bfde798735926c1a37748982ca0c')
        scaffold = '''#include <complex>
#include <vector>
#include <cmath>
#include <iostream>
#include <iomanip>
using namespace std;
enum EPSILONTYPE { ISOTROPIC=0, ANISOTROPIC=1, TETRAGONAL=2 };
template<class T> struct CMATRIX {complex<T> a[4][4]{};
void SetMatrixLine(int row,complex<T> x,complex<T> y,complex<T> z,complex<T> w){a[row][0]=x;a[row][1]=y;a[row][2]=z;a[row][3]=w;}};
'''
        wrapper = '''int main(){int kind;double angle,wave,thickness,real,imag;cout<<setprecision(17);
while(cin>>kind>>angle>>wave>>thickness>>real>>imag){complex<double> index(real,imag),roots[4];CMATRIX<double> tensor,boundary,propagation;
for(int row=0;row<3;++row)for(int col=0;col<3;++col){cin>>real>>imag;tensor.a[row][col]={real,imag};}
if(kind==0)SetMatrixIsotropic(propagation,boundary,roots,angle,wave,thickness,index);
else SetMatrixTetragonal(propagation,boundary,roots,angle,wave,thickness,index,tensor);
cout<<CDeltaBeta<double>::GetMatrixType(1e-8,tensor)<<' ';
for(auto value:roots)cout<<value.real()<<' '<<value.imag()<<' ';
for(auto matrix:{boundary,propagation})for(auto& row:matrix.a)for(auto value:row)cout<<value.real()<<' '<<value.imag()<<' ';
cout<<'\\n';}}
'''
        inputs = list(cases())
        if dispatch:
            wrapper = wrapper.replace('if(kind==0)SetMatrixIsotropic(propagation,boundary,roots,angle,wave,thickness,index);\nelse SetMatrixTetragonal(propagation,boundary,roots,angle,wave,thickness,index,tensor);',
                                      'SetMatrix(propagation,boundary,roots,angle,wave,thickness,index,kind,tensor,1e-8);')
            inputs = [(int(kind != 0), tensor, index, angle, wave, thickness) for kind, tensor, index, angle, wave, thickness in inputs]
            generator = random.Random(26025)
            for number in range(240):
                tensor = [0.] * 18
                for position in [0, 8, 16]: tensor[position:position+2] = [.99, .001]
                for row, column in [(0, 1), (0, 2), (1, 2)]:
                    real, imag = generator.uniform(-.001, .001), generator.uniform(-.001, .001)
                    tensor[2*(row*3+column):2*(row*3+column)+2] = [real, imag]
                    tensor[2*(column*3+row):2*(column*3+row)+2] = [-real, -imag]
                inputs.append((1, tensor, [1, 0], [.0, .01, .2, 1.0][number % 4], .3, 0 if number % 3 == 0 else 20))

        payload = '\n'.join(' '.join(map(str, [kind, angle, wave, thickness, *index, *tensor])) for kind, tensor, index, angle, wave, thickness in inputs)
        with tempfile.TemporaryDirectory(prefix='remagx-modes-') as temporary:
            source_path = Path(temporary) / 'reference.cpp'
            source_path.write_text(scaffold + 'template<class T>struct CDeltaBeta{\n' + classification + '\n};\n' + methods + wrapper)
            executable = Path(temporary) / 'reference'
            subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(source_path), '-o', str(executable)], check=True)
            lines = subprocess.run([str(executable)], input=payload, text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(lines), len(inputs))
        for arguments, line in zip(inputs, lines):
            expected = list(map(float, line.split()))
            self.assertEqual(classify(arguments[1], 1e-8), (0, int(expected[0])))
            status, actual = evaluate(*arguments, epsilon=1e-8 if dispatch else None)
            self.assertEqual(status, 0)
            self.assertEqual(len(expected), 73)
            for got, wanted in zip(actual, expected[1:]):
                self.assertTrue(math.isfinite(got) and abs(got - wanted) <= 1e-15 + 1e-10 * abs(wanted), (arguments, got, wanted))
        print(f'Original analytic modes: {len(inputs)*72} components and {len(inputs)} classifications matched.', flush=True)

if __name__ == '__main__': unittest.main()
