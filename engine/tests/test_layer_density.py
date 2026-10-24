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
Pointer = ctypes.POINTER(ctypes.c_double)
library.remagx_layer_density.argtypes = [Pointer, Pointer, ctypes.c_size_t, ctypes.c_size_t,
    Pointer, ctypes.c_size_t, Pointer, ctypes.c_size_t, Pointer]


def evaluate(boundaries, roughness, layer, positions, samples):
    packed = [(ctypes.c_double * len(values))(*values) for values in [boundaries, roughness, positions, samples]]
    output = (ctypes.c_double * len(positions))(*([-123.] * len(positions)))
    before = [bytes(values) for values in packed]
    status = library.remagx_layer_density(packed[0], packed[1], len(boundaries), layer,
        packed[2], len(positions), packed[3], len(samples), output)
    assert before == [bytes(values) for values in packed]
    return status, list(output)


def cases():
    generator = random.Random(26036)
    result = []
    for number in range(180):
        count = 2 + number % 7
        boundaries = [0.]
        for _ in range(count - 1):
            boundaries.append(boundaries[-1] + generator.uniform(.1, 40))
        roughness = [0 if (number + index) % 5 == 0 else generator.uniform(.01, 8) for index in range(count)]
        positions = [-1e10, 1e10, -100., 1000., *boundaries]
        positions += [generator.uniform(-50, boundaries[-1] + 50) for _ in range(25)]
        result.append((boundaries, roughness, number % count, positions))
    return result


class LayerDensityTest(unittest.TestCase):
    def test_production_lookup_is_full_double_standard_erf(self):
        generate = library.remagx_error_function_lookup
        generate.argtypes = [Pointer, ctypes.c_size_t]
        output = (ctypes.c_double * 1001)(*([-123.] * 1001))
        self.assertEqual(generate(None, 1001), 1)
        self.assertEqual(generate(output, 1000), 1)
        self.assertTrue(all(value == -123. for value in output))
        self.assertEqual(generate(output, 1001), 0)
        for index, value in enumerate(output):
            self.assertAlmostEqual(value, math.erf(-5. + index * 10. / 999.), delta=2e-15)
        self.assertTrue(all(left <= right for left, right in zip(output, output[1:])))
        self.assertLess(output[0], -.999999999)
        self.assertGreater(output[-1], .999999999)

    def test_sharp_interfaces_outer_limits_and_supplied_table(self):
        # Analytic synthetic samples, not a replacement for legacy initialization.
        samples = [(-5.0 + index * 10.0 / 999.0) / 5.0 for index in range(1001)]
        points = [-100, 0, 5, 10, 100]
        expected = [[1, .5, 0, 0, 0], [0, .5, 1, .5, 0], [0, 0, 0, .5, 1]]
        for layer in range(3):
            status, values = evaluate([0, 10, 20], [0, 0, 0], layer, points, samples)
            self.assertEqual(status, 0)
            for value, target in zip(values, expected[layer]):
                self.assertAlmostEqual(value, target, delta=1e-15)
        for layer, position in [(0, -1e10), (2, 1e10)]:
            status, value = evaluate([0, 10, 20], [0, 0, 0], layer, [position], samples)
            self.assertEqual(status, 0)
            self.assertAlmostEqual(value[0], .5, delta=1e-15)
        # Supplied zero samples expose the formula independently of interpolation.
        self.assertEqual(evaluate([0, 10, 20], [10, 10, 10], 1, [5], [0]*1001), (0, [.25]))

    def test_invalid_and_late_numerical_errors_are_atomic(self):
        for boundaries, widths, layer, points, samples in [
            ([0, 10], [1, 1], 2, [0], [0]*1001),
            ([0, 10], [1, 1], 0, [0], [0]*1000),
            ([0, 10], [1, math.nan], 0, [0], [0]*1001),
            ([0, 10], [1, 1], 0, [0, math.inf], [0]*1001),
            ([0, 10], [1, 1], 0, [0], [math.nan]*1001),
        ]:
            self.assertEqual(evaluate(boundaries, widths, layer, points, samples), (1, [-123]*len(points)))
        samples = [1e308 if index % 2 else -1e308 for index in range(1001)]
        self.assertEqual(evaluate([0, 10], [1, 1], 0, [-100, 0], samples), (2, [-123]*2))
        value = (ctypes.c_double * 1)(0)
        output = (ctypes.c_double * 1)(-123)
        table = (ctypes.c_double * 1001)()
        self.assertEqual(library.remagx_layer_density(value, value, 1, 0, value,
            ctypes.c_size_t(-1).value, table, 1001, output), 3)
        self.assertEqual(output[0], -123)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original density comparison not requested')
    def test_original_density_with_original_private_table(self):
        root = Path(os.environ['LEGACY_ROOT']) / 'shared'
        raw = (root / 'LayerSegmentation.cpp').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '5d7b1c3d0a5a784584f17fa49c92c1612569e362c2858d57b039da867e922e48')
        source = raw.decode('latin1').replace('\r\n', '\n')
        # Original table generation stays private in the temporary build. No NR
        # implementation, translation or generated legacy samples enter the repo.
        methods = source[source.index('double gammln('):source.index('/*\nvoid LayerSegmentation3')]
        source = (root / 'RechenHilfe.h').read_text(encoding='latin1')
        start = source.index('template<class T>\nT GetDensity(CVector<Schicht<T> > &mfs, int layer, T z)\n{')
        density = source[start:source.index('template<class T>\nvoid CalcMagProfile', start)]
        self.assertEqual(hashlib.sha256(density.encode()).hexdigest(), 'f23efb642a86e715d21c405ed8c03dad570c1f984d5304b14a1d473b0abcef22')
        scaffold = '''#include <cmath>
#include <vector>
#include <iostream>
#include <iomanip>
using namespace std;
template<class T> using CVector=std::vector<T>;
template<class T> struct Schicht {T z,sigma;};
void nrerror(const char*) {}
'''
        wrapper = r'''int main(){erffinit();cout<<setprecision(17);
for(double value:table)cout<<value<<' ';cout<<'\n';
int count,layer,points;while(cin>>count>>layer>>points){CVector<Schicht<double>> layers(count);
for(auto& value:layers)cin>>value.z;for(auto& value:layers)cin>>value.sigma;
for(int i=0;i<points;++i){double z;cin>>z;cout<<GetDensity(layers,layer,z)<<' ';}cout<<'\n';}}
'''
        prepared = cases()
        payload = '\n'.join(' '.join(map(str, [len(boundaries), layer, len(points), *boundaries, *widths, *points]))
                            for boundaries, widths, layer, points in prepared)
        with tempfile.TemporaryDirectory(prefix='remagx-density-') as temporary:
            cpp, exe = Path(temporary) / 'reference.cpp', Path(temporary) / 'reference'
            cpp.write_text(scaffold + methods + density + wrapper)
            subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(cpp), '-o', str(exe)],
                           capture_output=True, check=True)
            lines = subprocess.run([str(exe)], input=payload, text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(lines), len(prepared) + 1)
        samples = list(map(float, lines[0].split()))
        self.assertEqual(len(samples), 1001)
        comparisons = 0
        for arguments, line in zip(prepared, lines[1:]):
            status, values = evaluate(*arguments, samples)
            self.assertEqual(status, 0)
            reference = list(map(float, line.split()))
            self.assertEqual(len(values), len(reference))
            for value, expected in zip(values, reference):
                self.assertLessEqual(abs(value-expected), 1e-15 + 1e-10 * abs(expected))
                comparisons += 1
        print(f'Original density binding: {comparisons} weights matched using a privately generated original table.')


if __name__ == '__main__':
    if '--wasm-payload' in sys.argv:
        # Synthetic analytic table for public cross-runtime tests only. Production
        # table generation remains undecided; private original samples stay private.
        samples = [math.erf(-5.0 + index * 10.0 / 999.0) for index in range(1001)]
        payload = []
        for boundaries, roughness, layer, positions in cases():
            status, expected = evaluate(boundaries, roughness, layer, positions, samples)
            assert status == 0
            payload.append(dict(kind='density', boundaries=boundaries, roughness=roughness,
                layerIndex=layer, positions=positions, errorSamples=samples, expected=expected))
        print(json.dumps(payload))
    else:
        unittest.main()
