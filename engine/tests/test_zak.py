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
class Layer(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('thickness', 'roughness', 'delta', 'beta', 'delta_magnetic', 'beta_magnetic', 'gamma_degrees', 'phi_degrees')]
class Beam(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('sigma_real', 'sigma_imaginary', 'pi_real', 'pi_imaginary')]
class Result(ctypes.Structure):
    _fields_ = [('beam1', ctypes.c_double), ('beam2', ctypes.c_double)]
library.remagx_zak.argtypes = [ctypes.POINTER(Layer), ctypes.c_size_t, ctypes.c_double, ctypes.c_double, ctypes.c_int,
    ctypes.POINTER(Beam), ctypes.POINTER(Beam), ctypes.c_int, ctypes.POINTER(Result)]

def evaluate(layers, angle=.2, wave=.3, magnetic=1, analyzer=0, beam1=(1, 0, 0, 0), beam2=(0, 0, 1, 0)):
    source = (Layer * len(layers))(*layers)
    first, second = Beam(*beam1), Beam(*beam2)
    output = Result(-123, -456)
    before = bytes(source), bytes(first), bytes(second)
    status = library.remagx_zak(source, len(layers), angle, wave, magnetic, ctypes.byref(first), ctypes.byref(second), analyzer, ctypes.byref(output))
    assert before == (bytes(source), bytes(first), bytes(second))
    return status, [output.beam1, output.beam2]

def cases():
    generator = random.Random(26032)
    for number in range(120):
        layers = []
        for position in range(2 + number % 5):
            layers.append(Layer(generator.uniform(1, 60), 0 if number % 3 == 0 else generator.uniform(0, 3),
                generator.uniform(.001, .02), generator.uniform(.0001, .003),
                generator.uniform(-.001, .001), generator.uniform(-.0001, .0001),
                generator.uniform(-180, 180), generator.uniform(-180, 180)))
        if number % 2 == 0: layers[-1] = Layer()
        # First encountered zero-thickness film uses initially zero U; deeper
        # zero-thickness films reuse a nonzero previous U. Compare both cases.
        if len(layers) > 2 and number % 7 == 0: layers[-2].thickness = 0
        if len(layers) > 3 and number % 7 == 1: layers[1].thickness = 0
        first = tuple(generator.uniform(-1, 1) for _ in range(4))
        second = tuple(generator.uniform(-1, 1) for _ in range(4))
        for angle in [0, .01, .2, 1.]:
            for magnetic in [0, 1]:
                for analyzer in [0, 1, 2]:
                    yield layers, angle, .3, magnetic, analyzer, first, second

class ZakTest(unittest.TestCase):
    def test_fresnel_and_analyzers(self):
        index = complex(.99, .002)
        layers = [Layer(0, 0, .01, .002), Layer()]
        root = cmath.sqrt(index * index - math.cos(.2) ** 2)
        vacuum_root = math.sin(.2)
        sigma = abs((vacuum_root - root) / (vacuum_root + root)) ** 2
        pi = abs((index * index * vacuum_root - root) / (index * index * vacuum_root + root)) ** 2
        for analyzer, expected in [(0, [sigma, pi]), (1, [sigma, 0]), (2, [0, pi])]:
            status, values = evaluate(layers, analyzer=analyzer)
            self.assertEqual(status, 0)
            for actual, wanted in zip(values, expected):
                self.assertLessEqual(abs(actual - wanted), 1e-15 + 1e-10 * abs(wanted))
        baseline = evaluate(layers)
        layers[0].thickness = 1e10; layers[-1].thickness = -100
        self.assertEqual(evaluate(layers), baseline)
        self.assertEqual(evaluate([Layer(), Layer()]), (0, [0, 0]))

    def test_magnetism_and_beam_symmetry(self):
        layers = [Layer(0, 2, .01, .002, .001, .0001, 30, 60), Layer(20, 1, .006, .001, .0004, .00004, 45, 70), Layer()]
        first, second = (1, .2, .3, -.1), (.2, -.3, .4, .1)
        status, values = evaluate(layers, beam1=first, beam2=second)
        self.assertEqual(status, 0)
        self.assertEqual(evaluate(layers, beam1=second, beam2=first), (0, values[::-1]))
        disabled = evaluate(layers, magnetic=0)
        self.assertNotEqual(disabled[1], evaluate(layers)[1])
        for layer in layers: layer.delta_magnetic = layer.beta_magnetic = 0
        self.assertEqual(evaluate(layers), disabled)

    def test_errors_and_zero_thickness(self):
        layers = [Layer(0, 0, .01, .002), Layer()]
        for overrides in [dict(angle=math.nan), dict(wave=math.inf), dict(magnetic=2), dict(analyzer=3), dict(beam2=(math.nan, 0, 0, 0))]:
            self.assertEqual(evaluate(layers, **overrides), (1, [-123, -456]))
        self.assertEqual(evaluate(layers[:1]), (1, [-123, -456]))
        layers[0].delta = 1; layers[0].beta = 0
        self.assertEqual(evaluate(layers), (2, [-123, -456]))
        layers[0].delta = math.nan
        self.assertEqual(evaluate(layers), (1, [-123, -456]))
        self.assertEqual(evaluate([Layer(0, 0, .01, .002), Layer(0, 0, .006, .001), Layer()]), (2, [-123, -456]))
        self.assertEqual(library.remagx_zak(None, 2, .2, .3, 1, None, None, 0, None), 1)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original comparison not requested')
    def test_original(self):
        root = Path(os.environ['LEGACY_ROOT']) / 'shared'
        source = (root / 'simul/CZak.h').read_text(encoding='latin1')
        methods = source[source.index('template<class T>\nvoid inline SetMatrixZak'):source.index('\n#endif')]
        matrix = (root / 'CMatrix.h').read_text(encoding='latin1')
        self.assertEqual(hashlib.sha256(methods.encode()).hexdigest(), 'e156a982c6ddb04d6173ce3b1352ca3c3af501cc16c42d988f2cb7b3e0ee9af3')
        self.assertEqual(hashlib.sha256(matrix.encode()).hexdigest(), '2302d632af3438b6e601c5123c11ea81fdd2bc744072e543a008e66f9548834a')
        scaffold = '#include <iostream>\n#include <iomanip>\n#include <vector>\n#include <cmath>\n' + matrix
        scaffold += '''template<class T>struct Optical {T delta,beta,deltam,betam;};
template<class T>struct Schicht {T d,sigma;Optical<T> oc;T maggamma,magphi;};
struct CPolarization {double ray1sigmare,ray1sigmaim,ray1pire,ray1piim,ray2sigmare,ray2sigmaim,ray2pire,ray2piim;};
template<class T>struct CZak {vector<Schicht<T>> l;bool transmission=false;
void MatrixFormalism(const T&,const T&,bool,T&,T&,const CPolarization&,const T&,const int);
void AddRoughness(CMATRIX<T>&,const T&,const T&,const complex<T>&,const complex<T>&);};
'''
        wrapper = '''int main(){int count,magnetic,analyzer;double angle,wave;cout<<setprecision(17);
while(cin>>count>>angle>>wave>>magnetic>>analyzer){CZak<double> engine;CPolarization beam;
cin>>beam.ray1sigmare>>beam.ray1sigmaim>>beam.ray1pire>>beam.ray1piim>>beam.ray2sigmare>>beam.ray2sigmaim>>beam.ray2pire>>beam.ray2piim;
engine.l.resize(count);for(auto& layer:engine.l)cin>>layer.d>>layer.sigma>>layer.oc.delta>>layer.oc.beta>>layer.oc.deltam>>layer.oc.betam>>layer.maggamma>>layer.magphi;
double first,second;engine.MatrixFormalism(angle,wave,magnetic,second,first,beam,1e-8,analyzer);cout<<first<<' '<<second<<'\\n';}}
'''
        inputs = list(cases())
        payload = []
        for layers, angle, wave, magnetic, analyzer, first, second in inputs:
            values = [len(layers), angle, wave, magnetic, analyzer, *first, *second]
            for layer in layers: values.extend(getattr(layer, name) for name, _ in Layer._fields_)
            payload.append(' '.join(map(str, values)))
        with tempfile.TemporaryDirectory(prefix='remagx-zak-') as temporary:
            cpp, exe = Path(temporary) / 'reference.cpp', Path(temporary) / 'reference'
            cpp.write_text(scaffold + methods + wrapper)
            subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(cpp), '-o', str(exe)], check=True)
            lines = subprocess.run([str(exe)], input='\n'.join(payload), text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(lines), len(inputs))
        finite_count = error_count = 0
        for case_number, (arguments, line) in enumerate(zip(inputs, lines)):
            status, actual = evaluate(*arguments)
            expected = list(map(float, line.split()))
            self.assertEqual(len(expected), 2)
            if not all(math.isfinite(value) for value in expected):
                self.assertEqual((status, actual), (2, [-123, -456]), case_number)
                error_count += 1
                continue
            self.assertEqual(status, 0, case_number)
            for value, reference in zip(actual, expected):
                self.assertLessEqual(abs(value - reference), 1e-15 + 1e-10 * abs(reference), (case_number, value, reference))
                finite_count += 1
        print(f'Original Zak: {finite_count} finite intensities matched; {error_count} original nonfinite cases rejected atomically.')

if __name__ == '__main__':
    unittest.main()
