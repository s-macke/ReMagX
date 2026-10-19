import cmath
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
function = library.remagx_element_optics
pointer = ctypes.POINTER(ctypes.c_double)
function.argtypes = [pointer, ctypes.c_size_t, ctypes.c_double, pointer, pointer, pointer]


def calculate(rows, factor, tensors=None):
    elements = (ctypes.c_double * (5 * len(rows)))(*(value for row in rows for value in row))
    matrices = None if tensors is None else (ctypes.c_double * (18 * len(tensors)))(*(value for row in tensors for value in row))
    before = bytes(elements), None if matrices is None else bytes(matrices)
    scalar = (ctypes.c_double * 4)(*([-123] * 4))
    tensor = None if tensors is None else (ctypes.c_double * 18)(*([-123] * 18))
    status = function(elements, len(rows), factor, matrices, scalar, tensor)
    assert before == (bytes(elements), None if matrices is None else bytes(matrices))
    return status, list(scalar), None if tensor is None else list(tensor)


class ElementOpticsTest(unittest.TestCase):
    def test_vacuum_and_independent_scalar_formula(self):
        self.assertEqual(calculate([], 1), (0, [0] * 4, None))
        identity = [0.] * 18
        for index in (0, 8, 16): identity[index] = 1
        self.assertEqual(calculate([], 1, []), (0, [0] * 4, identity))
        status, scalar, _ = calculate([[2, 3, 4, 5, 6]], .01)
        expected = cmath.sqrt(complex(1 - .12, .16))
        self.assertEqual(status, 0)
        for actual, reference in zip(scalar, [1 - expected.real, expected.imag, .1, .12]):
            self.assertAlmostEqual(actual, reference, places=15)
        # The square root's branch remains meaningful across real-index zero.
        self.assertEqual(calculate([[1, 1, 0, 0, 0]], 1)[1], [1, 1, 0, 0])

    def test_matrix_uses_supplied_tensors_and_real_sign_reversal(self):
        supplied = list(range(1, 19))
        status, scalar, actual = calculate([[2, 0, 0, 0, 0]], .25, [supplied])
        self.assertEqual((status, scalar), (0, [0] * 4))
        expected = [(-value if index % 2 == 0 else value) + (1 if index in (0, 8, 16) else 0)
                    for index, value in enumerate(supplied)]
        self.assertEqual(actual, expected)

    def test_scalar_path_ignores_supplied_matrix_storage(self):
        rows = (ctypes.c_double * 5)(1, 0, 0, 0, 0)
        unused = (ctypes.c_double * 18)(*([math.nan] * 18))
        output = (ctypes.c_double * 4)()
        self.assertEqual(function(rows, 1, 1, unused, output, None), 0)
        self.assertEqual(list(output), [0] * 4)

    def test_invalid_and_overflow_are_atomic(self):
        for index in range(5):
            row = [1.] * 5; row[index] = math.nan
            self.assertEqual(calculate([row], 1, [[0] * 18]), (1, [-123] * 4, [-123] * 18))
        self.assertEqual(calculate([[1] * 5], math.inf), (1, [-123] * 4, None))
        self.assertEqual(calculate([[1] * 5], 1, [[math.nan] * 18]), (1, [-123] * 4, [-123] * 18))
        for rows, tensors in [([[1e308, 1e308, 0, 0, 0]], [[0] * 18]),
                              ([[1e308, 0, 0, 0, 0]], [[1e308] * 18])]:
            self.assertEqual(calculate(rows, 1, tensors), (2, [-123] * 4, [-123] * 18))
        scalar = (ctypes.c_double * 4)(*([-123] * 4))
        tensor = (ctypes.c_double * 18)(*([-123] * 18))
        rows = (ctypes.c_double * 5)(1, 2, 3, 4, 5)
        self.assertEqual(function(None, 1, 1, None, scalar, None), 1)
        self.assertEqual(function(rows, 1, 1, None, scalar, tensor), 1)
        self.assertEqual(function(rows, 1, 1, None, None, None), 1)
        self.assertEqual(list(scalar), [-123] * 4)
        self.assertEqual(list(tensor), [-123] * 18)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original comparison not requested')
    def test_original_prepared_density_conversion(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/RechenHilfe.h').read_text(encoding='latin1')
        start = source.index('void inline Element2oc(')
        end = source.index('void Element2Material(', start)
        method = source[source.rfind('template<class T>', 0, start):source.rfind('template<class T>', start, end)]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(), '24cd44f10ed8e8556456471e38f4b57b430b193ec226311dc3c6a573bed6ce63')
        scaffold = '''#include <complex>
#include <cmath>
#include <vector>
#include <iostream>
#include <iomanip>
using namespace std;
enum { MATRIX=1, ANISOTROPIC=1 };
template<class T> struct Tensor { complex<T> a[3][3]{}; void SetMatrixIdentity(){for(int i=0;i<3;i++)for(int j=0;j<3;j++)a[i][j]=i==j?1.:0.;} };
struct Element { double density,f1,f2,f1m,f2m; Tensor<double> F; double GetDensity(double) const {return density;} };
struct CFilm {vector<Element> el;};
struct CStateHandler {int algorithm; CFilm film; const CFilm* GetActiveFilm() const {return &film;} };
template<class T> struct CDeltaBeta {T delta,beta,deltam,betam; Tensor<T> epsilon; int epsilontype;};
'''
        main = '''int main(){int n,mode;double factor;while(cin>>n>>factor>>mode){CStateHandler s;s.algorithm=mode;s.film.el.resize(n);
for(auto& e:s.film.el){cin>>e.density>>e.f1>>e.f2>>e.f1m>>e.f2m;for(auto& row:e.F.a)for(auto& v:row){double r,i;cin>>r>>i;v={r,i};}}
CDeltaBeta<double> o;Element2oc(0.,factor,s,s,o);cout<<setprecision(17)<<o.delta<<' '<<o.beta<<' '<<o.deltam<<' '<<o.betam;
if(mode)for(auto& row:o.epsilon.a)for(auto v:row)cout<<' '<<v.real()<<' '<<v.imag();cout<<'\\n';}}
'''
        generator = random.Random(26024)
        cases, payload = [], []
        for index in range(400):
            count, matrix = index % 9, index % 2
            factor = (.0004151761541 * 1e6) / (generator.uniform(100, 30000) ** 2)
            rows = [[generator.uniform(-2, 20)] + [generator.uniform(-100, 100) for _ in range(4)] for _ in range(count)]
            tensors = [[generator.uniform(-100, 100) for _ in range(18)] for _ in rows]
            payload.append(' '.join(map(str, [count, factor, matrix])))
            payload.extend(' '.join(map(str, row + tensor)) for row, tensor in zip(rows, tensors))
            cases.append((rows, factor, tensors if matrix else None))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reference.cpp'; binary = Path(directory) / 'reference'
            path.write_text(scaffold + method + main)
            subprocess.run(['g++', '-std=c++17', '-O2', '-ffp-contract=off', str(path), '-o', str(binary)], capture_output=True, check=True)
            lines = subprocess.run([str(binary)], input='\n'.join(payload)+'\n', text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(lines), len(cases))
        compared = 0
        for line, case in zip(lines, cases):
            status, scalar, tensor = calculate(*case)
            self.assertEqual(status, 0)
            expected = list(map(float, line.split()))
            actual = scalar + (tensor or [])
            self.assertEqual(len(expected), len(actual))
            for value, reference in zip(actual, expected):
                self.assertLessEqual(abs(value-reference), 1e-15+1e-10*abs(reference))
                compared += 1
        self.assertEqual(compared, 5200)
        print('Original prepared element optics: 5,200 values matched.', flush=True)


if __name__ == '__main__': unittest.main()
