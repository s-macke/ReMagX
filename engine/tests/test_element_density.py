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
library.remagx_element_density.argtypes = [Pointer, ctypes.c_size_t, Pointer, ctypes.c_size_t,
    Pointer, ctypes.c_size_t, Pointer]


def evaluate(slabs, positions, samples):
    packed = [(ctypes.c_double * len(values))(*values) for values in
              [[value for row in slabs for value in row], positions, samples]]
    output = (ctypes.c_double * len(positions))(*([-123.] * len(positions)))
    before = [bytes(values) for values in packed]
    status = library.remagx_element_density(packed[0], len(slabs), packed[1], len(positions),
        packed[2], len(samples), output)
    assert before == [bytes(values) for values in packed]
    return status, list(output)


def cases():
    generator = random.Random(26037)
    result = []
    for number in range(180):
        count = 2 + number % 7
        slabs = [[generator.uniform(0, 30), 0 if (number + index) % 5 == 0 else generator.uniform(.01, 8),
                  generator.uniform(-1, 20)] for index in range(count)]
        boundaries = [0.]
        for row in slabs[1:-1]:
            boundaries.append(boundaries[-1] + row[0])
        positions = [-1e10, 1e10, -100., 1000., *boundaries]
        positions += [generator.uniform(-50, boundaries[-1] + 50) for _ in range(25)]
        result.append((slabs, positions))
    return result


class ElementDensityTest(unittest.TestCase):
    def test_sharp_interfaces_normalization_and_outer_thickness(self):
        samples = [(-5.0 + index * 10.0 / 999.0) / 5.0 for index in range(1001)]
        slabs = [[999, 0, 2], [10, 0, 6], [999, 0, 4]]
        status, values = evaluate(slabs, [-100, 0, 5, 10, 100], samples)
        self.assertEqual(status, 0)
        for value, expected in zip(values, [2, 4, 6, 5, 4]):
            self.assertAlmostEqual(value, expected, delta=1e-14)
        self.assertEqual(evaluate([[999, 10, 4], [10, 10, 4], [999, 10, 4]], [5], [0]*1001), (0, [4]))
        self.assertEqual(evaluate([[100, 0, -2]], [-100, 0], samples), (0, [-2, -2]))
        # A single substrate has no weight far above its boundary.
        self.assertEqual(evaluate([[100, 0, 2]], [-100, 100], samples), (2, [-123, -123]))

    def test_invalid_and_numerical_errors_are_atomic(self):
        for slabs, positions, samples in [
            ([], [0], [0]*1001),
            ([[1, -1, 2]], [0], [0]*1001),
            ([[math.nan, 1, 2]], [0], [0]*1001),
            ([[1, 1, math.inf]], [0], [0]*1001),
            ([[1, 1, 2]], [0, math.inf], [0]*1001),
            ([[1, 1, 2]], [0], [0]*1000),
            ([[1, 1, 2]], [0], [math.nan]*1001),
        ]:
            self.assertEqual(evaluate(slabs, positions, samples), (1, [-123]*len(positions)))
        self.assertEqual(evaluate([[0, 1, 2], [1e308, 1, 2], [1e308, 1, 2], [0, 1, 2]], [0], [0]*1001), (2, [-123]))
        samples = [1e308 if index % 2 else -1e308 for index in range(1001)]
        self.assertEqual(evaluate([[0, 1, 2], [0, 1, 3]], [-100, 0], samples), (2, [-123]*2))
        value = (ctypes.c_double * 3)(0, 0, 1)
        output = (ctypes.c_double * 1)(-123)
        table = (ctypes.c_double * 1001)()
        self.assertEqual(library.remagx_element_density(value, 1, value, ctypes.c_size_t(-1).value,
            table, 1001, output), 3)
        self.assertEqual(output[0], -123)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original element density comparison not requested')
    def test_original_density_with_private_original_table(self):
        root = Path(os.environ['LEGACY_ROOT']) / 'shared'
        raw = (root / 'LayerSegmentation.cpp').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '5d7b1c3d0a5a784584f17fa49c92c1612569e362c2858d57b039da867e922e48')
        source = raw.decode('latin1').replace('\r\n', '\n')
        # Keep original NR table generation and its samples private and temporary.
        methods = source[source.index('double gammln('):source.index('/*\nvoid LayerSegmentation3')]
        source = (root / 'schicht.h').read_text(encoding='latin1')
        start = source.index('\t\tdouble GetDensity(double z) const')
        density = source[start:source.index('\n};', start)]
        self.assertEqual(hashlib.sha256(density.encode()).hexdigest(), 'f1feab3f71a4fbe5cf25ad9228a9bad8ea6feeaf55ccaf71da48fa36ff1d79d9')
        scaffold = '''#include <cmath>
#include <vector>
#include <iostream>
#include <iomanip>
using namespace std;
template<class T> using CVector=std::vector<T>;
void nrerror(const char*) {}
'''
        wrapper = r'''int main(){erffinit();cout<<setprecision(17);
for(double value:table)cout<<value<<' ';cout<<'\n';
int count,points;while(cin>>count>>points){Element element;element.mfs.resize(count);
for(auto& row:element.mfs)cin>>row.d>>row.sigma>>row.density;
for(int i=0;i<points;++i){double z;cin>>z;cout<<element.GetDensity(z)<<' ';}cout<<'\n';}}
'''
        prepared = cases()
        payload = '\n'.join(' '.join(map(str, [len(slabs), len(points), *[value for row in slabs for value in row], *points]))
                            for slabs, points in prepared)
        with tempfile.TemporaryDirectory(prefix='remagx-element-density-') as temporary:
            cpp, exe = Path(temporary) / 'reference.cpp', Path(temporary) / 'reference'
            cpp.write_text(scaffold + methods + '\nstruct Slab {double d,sigma,density;};\nstruct Element {vector<Slab> mfs;\n' + density + '\n};\n' + wrapper)
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
        print(f'Original element density: {comparisons} values matched using a privately generated original table.')


if __name__ == '__main__':
    if '--wasm-payload' in sys.argv:
        # Synthetic samples for cross-runtime testing, not a production table.
        samples = [math.erf(-5.0 + index * 10.0 / 999.0) for index in range(1001)]
        payload = []
        for slabs, positions in cases():
            status, expected = evaluate(slabs, positions, samples)
            assert status == 0
            payload.append(dict(kind='element-density', slabs=slabs, positions=positions,
                                errorSamples=samples, expected=expected))
        print(json.dumps(payload))
    else:
        unittest.main()
