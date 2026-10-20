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
library.remagx_fourier.argtypes = [Pointer, Pointer, ctypes.c_size_t, Pointer, Pointer]


def calculate(qz, values):
    inputs = [(ctypes.c_double * len(column))(*column) for column in [qz, values]]
    outputs = [(ctypes.c_double * (len(qz) // 2))(*([-123.] * (len(qz) // 2))) for _ in range(2)]
    before = [bytes(column) for column in inputs]
    status = library.remagx_fourier(*inputs, len(qz), *outputs)
    assert before == [bytes(column) for column in inputs]
    return status, [list(column) for column in outputs]


class FourierTest(unittest.TestCase):
    def test_analytic_impulse_zero_and_independent_direct_transform(self):
        for count in [2, 3, 4, 7, 8, 17, 32, 47]:
            qz = [.01 * (index + 1) for index in range(count)]
            values = [.01 / (index + 1) for index in range(count)]
            status, (depths, actual) = calculate(qz, values)
            self.assertEqual(status, 0)
            windowed = [value * ((q * q) * (q * q)) * (.5 * (1 - math.cos(2 * 3.141592 * i / (count + 1)))) for i, (q, value) in enumerate(zip(qz, values))]
            for frequency in range(count // 2):
                real = sum(value * math.cos(2 * math.pi * frequency * i / count) for i, value in enumerate(windowed))
                imaginary = sum(-value * math.sin(2 * math.pi * frequency * i / count) for i, value in enumerate(windowed))
                expected = math.sqrt(real * real + imaginary * imaginary) if frequency else 0
                self.assertLessEqual(abs(actual[frequency] - expected), 1e-15 + 1e-10 * abs(expected))
                self.assertEqual(depths[frequency], 2 * 3.141592 * frequency / qz[-1])
            self.assertEqual(calculate(qz, [0.] * count)[1][1], [0.] * (count // 2))
            impulse = [0.] * count
            impulse[1] = 1
            output = calculate(qz, impulse)[1][1]
            expected = (qz[1] ** 2) ** 2 * .5 * (1 - math.cos(2 * 3.141592 / (count + 1)))
            for value in output[1:]:
                self.assertLessEqual(abs(value - expected), 1e-15 + 1e-10 * abs(expected))

    def test_large_non_power_of_two_two_impulse_interference(self):
        # Chirp index squares exceed 32-bit size_t at this length.
        count = 65537
        values = [0.] * count
        values[1] = values[-1] = 1
        status, (_, result) = calculate([1.] * count, values)
        self.assertEqual(status, 0)
        amplitudes = [.5 * (1 - math.cos(2 * 3.141592 * i / (count + 1))) for i in [1, count - 1]]
        for frequency in [1, count // 8, count // 4, count // 2 - 1]:
            angle = 2 * math.pi * ((frequency * (count - 2)) % count) / count
            expected = math.sqrt(amplitudes[0] ** 2 + amplitudes[1] ** 2 + 2 * amplitudes[0] * amplitudes[1] * math.cos(angle))
            self.assertLessEqual(abs(result[frequency] - expected), 1e-15 + 1e-10 * abs(expected))

    def test_failures_are_atomic(self):
        for qz, values in [([.1, 0], [1, 2]), ([.1, math.inf], [1, 2]), ([.1, .2], [1, math.nan]), ([.1, 1e200], [1, 1])]:
            status, output = calculate(qz, values)
            self.assertNotEqual(status, 0)
            self.assertEqual(output, [[-123.], [-123.]])
        data = (ctypes.c_double * 2)(.1, .2)
        for count in [0, 1, 1000001]:
            self.assertNotEqual(library.remagx_fourier(data, data, count, data, data), 0)
        self.assertNotEqual(library.remagx_fourier(None, data, 2, data, data), 0)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original FFT reference not requested')
    def test_original_fftw_method(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/CDataSet.h').read_text(encoding='latin1')
        self.assertEqual(hashlib.sha256(source.encode()).hexdigest(), '872ed4b90a2973969ec5981d77f184e35c30f9951658a00a27c6b5450b18ffe4')
        methods = []
        for signature in ['double inline LinInterpolation(', 'void FFT()']:
            start = source.index(signature)
            brace = source.index('{', start)
            depth, end = 1, brace + 1
            while depth:
                depth += (source[end] == '{') - (source[end] == '}')
                end += 1
            methods.append(source[start:end])
        scaffold = '#include <vector>\n#include <cmath>\n#include <iostream>\n#include <iomanip>\n#include <fftw3.h>\nusing namespace std;\nstruct Dataset {vector<double> qz,R;\n' + '\n'.join(methods) + '''};
int main(){size_t count;cout<<setprecision(17);while(cin>>count){Dataset data;data.qz.resize(count);data.R.resize(count);for(auto& x:data.qz)cin>>x;for(auto& x:data.R)cin>>x;data.FFT();for(auto x:data.qz)cout<<x<<' ';for(auto x:data.R)cout<<x<<' ';cout<<'\\n';}}
'''
        generator = random.Random(739)
        cases = []
        for count in [2, 3, 5, 8, 17, 31, 32, 64, 127, 128, 129, 300, 511, 512, 513, 1000]:
            for grid in ['ordered', 'unordered', 'constant']:
                qz = [.001 + index * .0007 for index in range(count)]
                if grid == 'unordered': generator.shuffle(qz)
                if grid == 'constant': qz = [.1] * count
                values = [generator.random() / (index + 1) for index in range(count)]
                cases.append((qz, values))
        payload = '\n'.join(' '.join(map(str, [len(qz), *qz, *values])) for qz, values in cases)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'reference.cpp').write_text(scaffold)
            try:
                subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(path / 'reference.cpp'), '-lfftw3', '-o', str(path / 'reference')], capture_output=True, check=True)
                rows = subprocess.run([str(path / 'reference')], input=payload, capture_output=True, text=True, check=True).stdout.splitlines()
            except subprocess.SubprocessError:
                self.fail('Private FFT reference failed; diagnostics withheld.')
        self.assertEqual(len(rows), len(cases))
        for (qz, values), row in zip(cases, rows):
            status, output = calculate(qz, values)
            self.assertEqual(status, 0)
            reference = list(map(float, row.split()))
            self.assertEqual(len(reference), sum(map(len, output)))
            for actual, expected in zip(output[0] + output[1], reference):
                self.assertLessEqual(abs(actual - expected), 1e-15 + 1e-10 * abs(expected))


if __name__ == '__main__':
    if '--wasm-payload' in sys.argv:
        generator = random.Random(739)
        payload = []
        for count in [2, 3, 5, 8, 17, 31, 32, 64, 127, 128, 129, 300, 511, 512, 513, 1000, 65537]:
            grids = ['ordered', 'unordered', 'constant'] if count != 65537 else ['large']
            for grid in grids:
                qz = [.001 + index * .0007 for index in range(count)]
                if grid == 'unordered': generator.shuffle(qz)
                if grid in ['constant', 'large']: qz = [.1] * count
                values = [generator.random() / (index + 1) for index in range(count)]
                status, output = calculate(qz, values)
                assert status == 0
                payload.append(dict(qz=qz, reflectivity=values, expected=output))
        print(json.dumps(payload))
    else:
        unittest.main()
