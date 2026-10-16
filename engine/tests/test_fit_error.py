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
function = library.remagx_fit_dataset_error
function.argtypes = [ctypes.c_int] + [Pointer] * 6 + [ctypes.c_size_t] + [ctypes.c_double] * 4 + [Pointer, ctypes.POINTER(ctypes.c_size_t), Pointer]
function.restype = ctypes.c_int

def evaluate(mode, columns, limits=(0, .5, 620, 680), residuals=True):
    count = len(columns[0])
    arrays = [(ctypes.c_double * count)(*column) if column is not None else None for column in columns]
    snapshots = [bytes(array) if array is not None else None for array in arrays]
    error = ctypes.c_double(123)
    accepted = ctypes.c_size_t(123)
    differences = (ctypes.c_double * count)(*([23.5] * count)) if residuals else None
    status = function(mode, *arrays, count, *limits, ctypes.byref(error), ctypes.byref(accepted), differences)
    assert snapshots == [bytes(array) if array is not None else None for array in arrays]
    return status, error.value, accepted.value, list(differences) if differences is not None else None

def cases():
    generator = random.Random(26041)
    output = []
    for number in range(120):
        count = 12
        qz = [0, .5] + [generator.uniform(-.1, .6) for _ in range(count - 2)]
        energy = [620, 680] + [generator.uniform(600, 700) for _ in range(count - 2)]
        intensities = [[10 ** generator.uniform(-300, 10) for _ in range(count)] for _ in range(4)]
        for column in range(4): intensities[column][(number + column) % count] = [0, -1][number % 2]
        for mode in range(8):
            values = intensities
            if mode in [2, 6]: values = [[generator.uniform(-2, 2) for _ in range(count)] for _ in range(4)]
            output.append((mode, [qz, energy, *values]))
    return output

class FitErrorTest(unittest.TestCase):
    def test_analytic_means_windows_and_skips(self):
        columns = [[0, .5, .2, .8], [620, 680, 600, 650], [1e-20, 1e-10, 0, 1], [1e-21, 1e-8, 1, 1],
                   [1, 1, 1, 1], [10, .01, 1, 1]]
        for mode in [0, 4]:
            self.assertEqual(evaluate(mode, columns), (0, 2.5, 2, [1, -2, 23.5, 23.5]))
        for mode in [3, 7]:
            self.assertEqual(evaluate(mode, columns), (0, 5, 2, [2, 4, 23.5, 23.5]))
        signed = [[0, .5, .2], [620, 680, 600], [-1, 0, 2], [1, 0, 0], [1, 1, 1], [1, 1, 1]]
        for mode in [2, 6]: self.assertEqual(evaluate(mode, signed), (0, 8/3, 3, [-2, 0, 2]))
        for mode in [1, 5]: self.assertEqual(evaluate(mode, signed), (0, 0, 0, [23.5]*3))
        positive = [[0, .5, .2], [620, 680, 600], [2, 4, 6], [1, 2, 3], [1]*3, [1]*3]
        self.assertEqual(evaluate(1, positive), (0, 14/3, 3, [1, 2, 3]))
        self.assertEqual(evaluate(5, positive), (0, 2.5, 2, [1, 2, 23.5]))
        for mode in range(8):
            self.assertEqual(evaluate(mode, columns, (1, 0, 620, 680)), (0, 0, 0, [23.5]*4))
            self.assertEqual(evaluate(mode, [[]]*6), (0, 0, 0, []))
        for mode in [0, 1, 2, 6]:
            minimal = [positive[0], None, positive[2], positive[3], None, None]
            self.assertEqual(evaluate(mode, minimal, residuals=False)[:3], evaluate(mode, positive)[:3])
        for mode in [3, 7]:
            no_energy = [columns[0], None, *columns[2:]]
            self.assertEqual(evaluate(mode, no_energy), evaluate(mode, columns))

    def test_atomic_errors(self):
        columns = [[0, .1], [650, 650], [1, 1], [2, 2], [1, 1], [2, 2]]
        for mode in [-1, 8]: self.assertEqual(evaluate(mode, columns), (1, 123, 123, [23.5]*2))
        invalid = [column[:] for column in columns]; invalid[2][1] = math.nan
        self.assertEqual(evaluate(0, invalid), (1, 123, 123, [23.5]*2))
        overflow = [column[:] for column in columns]; overflow[2][1] = 1e308
        self.assertEqual(evaluate(1, overflow), (2, 123, 123, [23.5]*2))
        missing = columns[:]; missing[1] = None
        self.assertEqual(evaluate(4, missing), (1, 123, 123, [23.5]*2))
        missing = columns[:]; missing[4] = None
        self.assertEqual(evaluate(3, missing), (1, 123, 123, [23.5]*2))

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private legacy source not requested')
    def test_original_functions(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/CError.cpp').read_text(encoding='latin1')
        self.assertEqual(hashlib.sha256(source.encode()).hexdigest(), '04fd3895a30b5aa7c4cdacad253566fee5c4ff19cc4a2d11ae174a4b1a7003bd')
        names = ['Reflectivity', 'ReflectivityLin', 'Asymmetry', 'DicReflectivity', 'EScanLog', 'EScanLin', 'AsymEScan', 'DicEScan']
        functions, declarations = [], []
        for name in names:
            start = source.index('double CError::' + name + '(')
            brace = source.index('{', start)
            depth, end = 1, brace + 1
            while depth:
                depth += (source[end] == '{') - (source[end] == '}')
                end += 1
            functions.append(source[start:end])
            declarations.append(source[start:brace].replace('double CError::', 'static double ') + ';')
        scaffold = '#include <vector>\n#include <cmath>\n#include <iostream>\n#include <iomanip>\nusing namespace std;\ntemplate<class T> using CVector=vector<T>;\nstruct CDataSet {vector<double> qz,eng,R,A,Rp,Rm;};\n'
        scaffold += 'class CError {public:' + '\n'.join(declarations) + '};\n' + '\n'.join(functions)
        scaffold += '''
int main(){int mode,count;cout<<setprecision(17);while(cin>>mode>>count){
CDataSet measured,calculated;vector<double> columns[6];
for(auto& column:columns){column.resize(count);for(auto& value:column)cin>>value;}
measured.qz=columns[0];measured.eng=columns[1];
measured.R=measured.A=measured.Rp=columns[2];calculated.R=calculated.A=calculated.Rp=columns[3];
measured.Rm=columns[4];calculated.Rm=columns[5];
vector<double> residuals(count,23.5);double error=0;switch(mode){
'''
        for mode, name in enumerate(names):
            arguments = 'calculated,measured,residuals,0,.5,' + ('620,680,' if mode in [4, 5] else '') + '1,0'
            scaffold += f'case {mode}:error=CError::{name}({arguments});break;\n'
        scaffold += "}cout<<error;for(auto value:residuals)cout<<' '<<value;cout<<'\\n';}}\n"
        prepared = cases()
        payload = '\n'.join(' '.join(map(str, [mode, len(columns[0]), *[value for column in columns for value in column]])) for mode, columns in prepared)
        with tempfile.TemporaryDirectory(prefix='remagx-fit-error-') as temporary:
            path = Path(temporary); (path/'reference.cpp').write_text(scaffold)
            subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(path/'reference.cpp'), '-o', str(path/'reference')], capture_output=True, check=True)
            lines = subprocess.run([str(path/'reference')], input=payload, text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(lines), len(prepared))
        for (mode, columns), line in zip(prepared, lines):
            expected = list(map(float, line.split()))
            self.assertEqual(len(expected), len(columns[0]) + 1)
            status, error, accepted, residuals = evaluate(mode, columns)
            self.assertEqual(status, 0)
            self.assertEqual(accepted, sum(value != 23.5 for value in expected[1:]))
            for actual, reference in zip([error, *residuals], expected):
                self.assertTrue(math.isfinite(actual) and abs(actual-reference) <= 1e-15+1e-10*abs(reference), (mode, actual, reference))
        print('Original dataset objectives: 12,480 means/residuals across eight modes matched.')

if __name__ == '__main__': unittest.main()
