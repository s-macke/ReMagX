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

library.remagx_zak_qz.argtypes = [ctypes.POINTER(Layer), ctypes.c_size_t, ctypes.POINTER(ctypes.c_double),
    ctypes.c_size_t, ctypes.c_double, ctypes.c_int, ctypes.POINTER(Beam), ctypes.POINTER(Beam),
    ctypes.c_int, ctypes.c_int, ctypes.POINTER(Result)]
library.remagx_zak_qz_resolution.argtypes = library.remagx_zak_qz.argtypes[:-1] + [ctypes.c_double, ctypes.c_int, ctypes.POINTER(Result)]

def evaluate_qz(layers, qz, energy=640., magnetic=1, analyzer=0, mode=1,
                beam1=(1, 0, 0, 0), beam2=(0, 0, 1, 0), resolution=None):
    source, points = (Layer * len(layers))(*layers), (ctypes.c_double * len(qz))(*qz)
    first, second = Beam(*beam1), Beam(*beam2) if beam2 is not None else None
    output = (Result * len(qz))(*(Result(-123, -456) for _ in qz))
    before = bytes(source), bytes(points), bytes(first), bytes(second) if second else None
    arguments = [source, len(layers), points, len(qz), energy, magnetic, ctypes.byref(first),
                 ctypes.byref(second) if second else None, analyzer, mode]
    status = library.remagx_zak_qz(*arguments, output) if resolution is None else library.remagx_zak_qz_resolution(*arguments, *resolution, output)
    assert before == (bytes(source), bytes(points), bytes(first), bytes(second) if second else None)
    return status, [value for row in output for value in (row.beam1, row.beam2)]

library.remagx_zak_energy_scan.argtypes = [ctypes.POINTER(Layer), ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_int), ctypes.c_size_t,
    ctypes.c_int, ctypes.POINTER(Beam), ctypes.POINTER(Beam), ctypes.c_int, ctypes.c_int,
    ctypes.c_double, ctypes.c_double, ctypes.POINTER(Result)]
library.remagx_energy_resolution.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.POINTER(Result),
    ctypes.c_size_t, ctypes.c_double, ctypes.POINTER(Result)]

def evaluate_energy(stacks, energy, qz, enabled=None, magnetic=1, analyzer=0, mode=1,
                    beam1=(1, 0, 0, 0), beam2=(0, 0, 1, 0), angular=0., width=0.):
    count, layer_count = len(energy), len(stacks[0])
    source = (Layer * (count * layer_count))(*(entry for stack in stacks for entry in stack))
    energies, points = (ctypes.c_double * count)(*energy), (ctypes.c_double * count)(*qz)
    mask = (ctypes.c_int * count)(*enabled) if enabled is not None else None
    first, second = Beam(*beam1), Beam(*beam2) if beam2 is not None else None
    output = (Result * count)(*(Result(-123, -456) for _ in energy))
    inputs = [source, energies, points, first] + ([mask] if mask is not None else []) + ([second] if second is not None else [])
    before = [bytes(item) for item in inputs]
    status = library.remagx_zak_energy_scan(source, layer_count, energies, points, mask, count, magnetic,
        ctypes.byref(first), ctypes.byref(second) if second is not None else None, analyzer, mode, angular, width, output)
    assert before == [bytes(item) for item in inputs]
    return status, [value for row in output for value in (row.beam1, row.beam2)]

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

    def test_qz_matches_single_angle(self):
        comparisons = 0
        for number, prepared in enumerate(list(cases())[::24]):
            layers, _, _, _, _, first, second = prepared
            for entry in layers[1:-1]:
                if entry.thickness == 0: entry.thickness = 15
            energy = [100, 640, 8000][number % 3]
            wave = 2 * math.pi / (12398.326 / energy)
            qz = [.2 * wave, 0, .04 * wave, .2 * wave]
            for mode in [0, 1]:
                status, actual = evaluate_qz(layers, qz, energy=energy, magnetic=number%2,
                    mode=mode, analyzer=number%3, beam1=first, beam2=second if mode else None)
                self.assertEqual(status, 0)
                for index, coordinate in enumerate(qz):
                    status, expected = evaluate(layers, math.asin(coordinate / (2 * wave)), wave,
                        number%2, number%3, first, second)
                    self.assertEqual(status, 0)
                    if not mode: expected[1] = 0
                    self.assertEqual(actual[2*index:2*index+2], expected)
                    comparisons += 2
        self.assertEqual(comparisons, 1920)

    def test_qz_boundaries_and_atomic_errors(self):
        layers = [Layer(0, 0, .01, .001), Layer()]
        boundary = 2 * (2 * math.pi / (12398.326 / 640))
        for coordinate, mode, status in [(boundary, 0, 4), (-boundary, 0, 4),
            (boundary, 1, 0), (-boundary, 1, 0), (math.nextafter(boundary, math.inf), 1, 4)]:
            actual, output = evaluate_qz(layers, [.01, coordinate], mode=mode)
            self.assertEqual(actual, status)
            if status: self.assertEqual(output, [-123, -456] * 2)
        self.assertEqual(evaluate_qz(layers, [.01, boundary], resolution=(0, 1)), (4, [-123, -456]*2))
        self.assertEqual(evaluate_qz(layers, [-.01], mode=0, beam2=None), (0, [0, 0]))
        for options in [dict(energy=0), dict(magnetic=2), dict(mode=3), dict(beam2=None),
                        dict(resolution=(-1, 0)), dict(resolution=(0, 2))]:
            self.assertEqual(evaluate_qz(layers, [.01], **options), (1, [-123, -456]))
        self.assertEqual(evaluate_qz(layers, [.01, math.nan]), (1, [-123, -456]*2))
        # A later nonfinite calculation leaves even the earlier skipped point untouched.
        broken_stack = [Layer(0, 0, .01, .002), Layer(0, 0, .006, .001), Layer()]
        self.assertEqual(evaluate_qz(broken_stack, [-.01, .03]), (2, [-123, -456]*2))
        self.assertEqual(evaluate_qz(broken_stack, [-.01, .03], resolution=(0, 0)), (2, [-123, -456]*2))
        # A negative coordinate skips physics, but does not bypass input validation.
        layers[0].delta = math.nan
        self.assertEqual(evaluate_qz(layers, [-.01]), (1, [-123, -456]))

    def test_qz_resolution_against_reviewed_kernel(self):
        offsets = [-2, -1.77777777777778, -1.55555555555556, -1.33333333333333,
            -1.11111111111111, -.888888888888889, -.666666666666667, -.444444444444444,
            -.222222222222222, 0, .222222222222222, .444444444444444, .666666666666667,
            .888888888888889, 1.11111111111111, 1.33333333333333, 1.55555555555556, 1.77777777777778, 2]
        inputs, actuals = [], []
        for number, prepared in enumerate(list(cases())[::24]):
            layers, _, _, _, _, first, second = prepared
            for entry in layers[1:-1]:
                if entry.thickness == 0: entry.thickness = 15
            energy = [100, 640, 8000][number % 3]
            wave = 2 * math.pi / (12398.326 / energy)
            qz = [ratio * 2 * wave for ratio in [-.02, 0, .05, .2, .4]]
            if number % 4 == 0: qz.reverse()
            options = dict(energy=energy, magnetic=number%2, analyzer=number % 3,
                           mode=(number//3)%2, beam1=first, beam2=second)
            for width in [0, 1e-11, wave*.01]:
                for fast in [0, 1]:
                    coordinates = qz if fast else [value+offset*width for value in qz for offset in (offsets[:1] if width < 1e-10 else offsets)]
                    status, raw = evaluate_qz(layers, coordinates, **options)
                    self.assertEqual(status, 0)
                    status, actual = evaluate_qz(layers, qz, resolution=(width, fast), **options)
                    self.assertEqual(status, 0)
                    inputs.append(dict(qz=qz, raw=raw, width=width, fast=bool(fast), dichroic=bool(options['mode'])))
                    actuals.append(actual)
        reference = json.loads(subprocess.run(['node', '--experimental-strip-types',
            str(Path(__file__).with_name('compare_resolution.mjs'))], input=json.dumps(inputs),
            text=True, capture_output=True, check=True).stdout)
        for actual, expected in zip(actuals, reference):
            for value, target in zip(actual, expected['values']):
                self.assertLessEqual(abs(value-target), 1e-15+1e-10*abs(target))
        self.assertEqual(len(actuals), 720)
        print('Zak angular resolution: 7,200 intensity comparisons matched reviewed kernel.', flush=True)

    def test_energy_scan_matches_per_energy_and_convolution(self):
        comparisons = 0
        for number, prepared in enumerate(list(cases())[::24]):
            layers, _, _, _, _, first, second = prepared
            magnetic = number % 2
            stacks = []
            for point in range(4):
                stack = [Layer.from_buffer_copy(entry) for entry in layers]
                for entry in stack[:-1]:
                    entry.delta += .0001 * point
                    entry.delta_magnetic += .00001 * point
                    if entry.thickness == 0: entry.thickness = 15
                stacks.append(stack)
            energies = [640, 645, 642, 650]
            qz = [-.001, .001, .03, .08]
            enabled = [1, number % 2, 1, 1]
            angular, width = [0, 1e-11, .002][number % 3], [0, 1e-11, 1e-10, .5][number % 4]
            for mode in [0, 1]:
                raw = []
                for point in range(4):
                    if not enabled[point]: raw.append(Result(1, mode)); continue
                    status, values = evaluate_qz(stacks[point], [qz[point]], energies[point], magnetic,
                        number % 3, mode, first, second, resolution=(angular, 0))
                    self.assertEqual(status, 0)
                    raw.append(Result(*values))
                expected = (Result * 4)()
                self.assertEqual(library.remagx_energy_resolution((ctypes.c_double * 4)(*energies),
                    (Result * 4)(*raw), 4, width, expected), 0)
                status, actual = evaluate_energy(stacks, energies, qz, enabled, magnetic,
                    number % 3, mode, first, second, angular, width)
                self.assertEqual(status, 0)
                self.assertEqual(actual, [value for row in expected for value in (row.beam1, row.beam2)])
                comparisons += 8
        self.assertEqual(comparisons, 1920)
        print(f'Native Zak energy scans: {comparisons} intensities matched per-energy reference.', flush=True)

    def test_energy_scan_atomic_errors_and_disabled_stacks(self):
        stacks = [[Layer(0, 0, .01, .001), Layer()], [Layer(0, 0, .02, .002), Layer()]]
        sentinel = [-123, -456] * 2
        self.assertEqual(evaluate_energy(stacks, [640, 650], [.03, .04]),
                         evaluate_energy(stacks, [640, 650], [.03, .04], enabled=[1, 1]))
        self.assertEqual(evaluate_energy(stacks, [640, 650], [.03, 100]), (4, sentinel))
        for options in [dict(magnetic=2), dict(mode=2), dict(enabled=[1, 2]), dict(angular=-1), dict(width=-1), dict(beam2=None)]:
            self.assertEqual(evaluate_energy(stacks, [640, 650], [.03, .04], **options), (1, sentinel))
        self.assertEqual(evaluate_energy(stacks, [640, 0], [.03, .04]), (1, sentinel))
        self.assertEqual(evaluate_energy(stacks, [640, 650], [.03, .04], width=1e308), (2, sentinel))
        stacks[1][0].delta = 1
        stacks[1][0].beta = 0
        self.assertEqual(evaluate_energy(stacks, [640, 650], [.03, .04]), (2, sentinel))
        stacks[1][0].delta = math.nan
        self.assertEqual(evaluate_energy(stacks, [640, 650], [.03, .04]), (1, sentinel))
        status, actual = evaluate_energy(stacks, [640, 650], [.03, 100], enabled=[1, 0])
        self.assertEqual(status, 0)
        self.assertEqual(actual[2:], [1, 1])
        status, actual = evaluate_energy(stacks, [640, 650], [.03, 100], enabled=[0, 0], mode=0, beam2=None)
        self.assertEqual((status, actual), (0, [1, 0, 1, 0]))

    def test_energy_dimensions_overflow_before_reading_stacks(self):
        source = (Layer * 2)(Layer(), Layer())
        energy, qz = (ctypes.c_double * 1)(640), (ctypes.c_double * 1)(.03)
        beam, output = Beam(1, 0, 0, 0), Result(-123, -456)
        status = library.remagx_zak_energy_scan(source, 2, energy, qz, None,
            ctypes.c_size_t(-1).value, 0, ctypes.byref(beam), None, 0, 0, 0, 0, ctypes.byref(output))
        self.assertEqual(status, 3)
        self.assertEqual([output.beam1, output.beam2], [-123, -456])

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
