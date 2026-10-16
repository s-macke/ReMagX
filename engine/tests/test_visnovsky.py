import cmath
import ctypes
import hashlib
import json
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
    _fields_ = [(name, ctypes.c_double) for name in ('thickness', 'roughness', 'index_real', 'index_imaginary')] + [('dielectric', ctypes.c_double * 18), ('anisotropic', ctypes.c_int)]
class Beam(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('sigma_real', 'sigma_imaginary', 'pi_real', 'pi_imaginary')]
class Result(ctypes.Structure):
    _fields_ = [('beam1', ctypes.c_double), ('beam2', ctypes.c_double)]
library.remagx_visnovsky.argtypes = [ctypes.POINTER(Layer), ctypes.c_size_t, ctypes.c_double, ctypes.c_double, ctypes.c_double, ctypes.POINTER(Beam), ctypes.POINTER(Beam), ctypes.c_int, ctypes.POINTER(Result)]

def layer(index=1+0j, thickness=0., roughness=0., kind=0):
    result = Layer(thickness, roughness, index.real, index.imag, (ctypes.c_double * 18)(), kind)
    for position in [0, 8, 16]: result.dielectric[position:position+2] = [(index*index).real, (index*index).imag]
    return result

def evaluate(layers, angle=.2, wave=.3, epsilon=1e-8, analyzer=0, beam1=(1, 0, 0, 0), beam2=(0, 0, 1, 0)):
    source = (Layer * len(layers))(*layers)
    first, second = Beam(*beam1), Beam(*beam2)
    output = Result(-123, -456)
    before = bytes(source), bytes(first), bytes(second)
    status = library.remagx_visnovsky(source, len(layers), angle, wave, epsilon, ctypes.byref(first), ctypes.byref(second), analyzer, ctypes.byref(output))
    assert before == (bytes(source), bytes(first), bytes(second))
    return status, [output.beam1, output.beam2]

def cases():
    generator = random.Random(26026)
    for number in range(120):
        layers = []
        for position in range(2 + number % 5):
            index = complex(generator.uniform(.97, .999), generator.uniform(.00001, .002))
            entry = layer(index, generator.uniform(0, 100), 0 if number % 4 == 0 else generator.uniform(0, 5), int(number % 3 != 0))
            if number % 3 == 1:
                entry.dielectric[16] += .002
            elif number % 3 == 2:
                for row, column in [(0, 1), (0, 2), (1, 2)]:
                    real, imag = generator.uniform(-.001, .001), generator.uniform(-.001, .001)
                    entry.dielectric[2*(row*3+column):2*(row*3+column)+2] = [real, imag]
                    entry.dielectric[2*(column*3+row):2*(column*3+row)+2] = [-real, -imag]
            layers.append(entry)
        # Include non-vacuum isotropic ambient as well as the usual vacuum.
        layers[-1] = layer(1+0j if number % 2 else .999+.00001j)
        for angle in [0, .01, .2, 1.0]:
            for analyzer in range(3):
                yield layers, angle, .3, 1e-8, analyzer, (1, .2, .3, -.1), (.2, -.3, .4, .1)

class VisnovskyTest(unittest.TestCase):
    def test_single_interface_fresnel_and_analyzer(self):
        index = complex(.99, .001)
        angle = .2
        sine = math.sin(angle)
        root = cmath.sqrt(index*index - math.cos(angle)**2)
        sigma = abs((sine-root)/(sine+root))**2
        pi = abs((index*index*sine-root)/(index*index*sine+root))**2
        for analyzer, expected in [(0, [sigma, pi]), (1, [sigma, 0]), (2, [0, pi])]:
            status, values = evaluate([layer(index), layer()], analyzer=analyzer)
            self.assertEqual(status, 0)
            for actual, wanted in zip(values, expected): self.assertLessEqual(abs(actual-wanted), 1e-15+1e-10*abs(wanted))
        self.assertEqual(evaluate([layer(), layer()]), (0, [0, 0]))

    def test_atomic_errors_and_ignored_boundary_thickness(self):
        self.assertEqual(evaluate([layer()]), (1, [-123, -456]))
        self.assertEqual(evaluate([layer(), layer()], angle=math.nan), (1, [-123, -456]))
        self.assertEqual(evaluate([layer(), layer()], analyzer=3), (1, [-123, -456]))
        self.assertEqual(evaluate([layer(), layer()], beam1=(math.inf, 0, 0, 0)), (1, [-123, -456]))
        self.assertEqual(evaluate([layer(0j), layer()]), (2, [-123, -456]))
        stack = [layer(.99+.001j), layer(.98+.002j, 20, 2), layer()]
        expected = evaluate(stack)
        stack[0].thickness = 1e300; stack[-1].thickness = -1e300
        self.assertEqual(evaluate(stack), expected)
        stack[0].dielectric[4] = math.nan
        self.assertEqual(evaluate(stack), (1, [-123, -456]))
        stack[0].dielectric[4] = 0
        stack[1].thickness = 1e308
        self.assertEqual(evaluate(stack), (2, [-123, -456]))

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original stack comparison not requested')
    def test_original_stack(self):
        root = Path(os.environ['LEGACY_ROOT']) / 'shared'
        source = (root / 'simul/CVisnovsky.h').read_text(encoding='latin1')
        matrix = (root / 'CMatrix.h').read_text(encoding='latin1')
        analytic = source[source.index('template <class T>\nvoid SolvePolynomial('):source.index('template<class T>\ninline void SetMaxwellMatrix')]
        dispatch = source[source.index('template<class T>\nvoid inline SetMatrixAnisotropic'):source.index('template<class T>\nvoid CVisnovsky<T>::AddRoughness')]
        stack = source[source.index('template<class T>\nvoid CVisnovsky<T>::AddRoughness'):source.index('\n#endif')]
        material = (root / 'MaterialConstants.h').read_text(encoding='latin1')
        classification = material[material.index('static EPSILONTYPE GetMatrixType'):material.index('\n};', material.index('static EPSILONTYPE GetMatrixType'))]
        for part, digest in [(matrix, '2302d632af3438b6e601c5123c11ea81fdd2bc744072e543a008e66f9548834a'),
            (analytic, '451d6e8cde451882f09005dc8dfc0e7251f75f35c489955e588dd50028860085'),
            (dispatch, '3d3bf323746596866736078eda967bcda3913069f32be97d6563350cb5cfa8b8'),
            (stack, '3ca951865989fefcc4e83669d9d08387cabc82e78b58b239164536081cf2f32c'),
            (classification, 'd126d2231fa3d8b068b4960e9efdb6edf9d8bfde798735926c1a37748982ca0c')]:
            self.assertEqual(hashlib.sha256(part.encode()).hexdigest(), digest)
        scaffold = '#include <iostream>\n#include <iomanip>\n#include <vector>\n#include <cmath>\n' + matrix
        scaffold += '''enum EPSILONTYPE { ISOTROPIC=0, ANISOTROPIC=1, TETRAGONAL=2 };
template<class T> struct CDeltaBeta {T delta,beta;int epsilontype;CMATRIX<T> epsilon;
''' + classification + '\n};\n'
        scaffold += '''template<class T>struct Schicht {T d,sigma; CDeltaBeta<T> oc;};
struct CPolarization {double ray1sigmare,ray1sigmaim,ray1pire,ray1piim,ray2sigmare,ray2sigmaim,ray2pire,ray2piim;};
template<class T>struct CVisnovsky {vector<Schicht<T>> l;bool transmission=false;
void MatrixFormalism(T,const T&,bool,T&,T&,const CPolarization&,const T&,const int);
void AddRoughness(CMATRIX<T>&,const T&,const T&,const complex<T>*,const complex<T>*);};
'''
        wrapper = '''int main(){int count,analyzer;double angle,wave,epsilon;cout<<setprecision(17);
while(cin>>count>>angle>>wave>>epsilon>>analyzer){CVisnovsky<double> engine;CPolarization beam;
cin>>beam.ray1sigmare>>beam.ray1sigmaim>>beam.ray1pire>>beam.ray1piim>>beam.ray2sigmare>>beam.ray2sigmaim>>beam.ray2pire>>beam.ray2piim;
engine.l.resize(count);for(auto& layer:engine.l){double index;cin>>layer.d>>layer.sigma>>index>>layer.oc.beta>>layer.oc.epsilontype;layer.oc.delta=1-index;
for(int row=0;row<3;++row)for(int col=0;col<3;++col){double real,imag;cin>>real>>imag;layer.oc.epsilon.a[row][col]={real,imag};}}
double first,second;engine.MatrixFormalism(angle,wave,false,second,first,beam,epsilon,analyzer);cout<<first<<' '<<second<<'\\n';}}
'''
        inputs = list(cases())
        payload = []
        for layers, angle, wave, epsilon, analyzer, first, second in inputs:
            values = [len(layers), angle, wave, epsilon, analyzer, *first, *second]
            for entry in layers: values.extend([entry.thickness, entry.roughness, entry.index_real, entry.index_imaginary, entry.anisotropic, *entry.dielectric])
            payload.append(' '.join(map(str, values)))
        with tempfile.TemporaryDirectory(prefix='remagx-visnovsky-') as temporary:
            source_path = Path(temporary) / 'reference.cpp'
            source_path.write_text(scaffold + analytic + dispatch + stack + wrapper)
            executable = Path(temporary) / 'reference'
            subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(source_path), '-o', str(executable)], check=True)
            lines = subprocess.run([str(executable)], input='\n'.join(payload), text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(lines), len(inputs))
        for case_number, (arguments, line) in enumerate(zip(inputs, lines)):
            status, actual = evaluate(*arguments)
            self.assertEqual(status, 0, case_number)
            expected = list(map(float, line.split()))
            self.assertEqual(len(expected), 2)
            for got, wanted in zip(actual, expected):
                self.assertTrue(math.isfinite(got) and math.isfinite(wanted) and abs(got-wanted) <= 1e-15+1e-10*abs(wanted), (case_number, got, wanted))
        print(f'Original Visnovsky stacks: {len(inputs)*2} intensities matched.', flush=True)

if __name__ == '__main__':
    if '--wasm-payload' in sys.argv:
        payload = []
        for arguments in cases():
            layers, angle, wave, epsilon, analyzer, first, second = arguments
            status, expected = evaluate(*arguments)
            assert status == 0
            payload.append(dict(layers=[dict(values=[entry.thickness, entry.roughness, entry.index_real,
                entry.index_imaginary, *entry.dielectric], anisotropic=entry.anisotropic) for entry in layers],
                angle=angle, waveNumber=wave, epsilon=epsilon, analyzer=analyzer, beam1=first, beam2=second, expected=expected))
        print(json.dumps(payload))
    else:
        unittest.main()
