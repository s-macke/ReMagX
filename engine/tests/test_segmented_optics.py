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
library.remagx_segmented_optics.argtypes = [Pointer, ctypes.c_size_t, Pointer, Pointer, ctypes.c_int,
    ctypes.c_double, Pointer, ctypes.c_size_t, Pointer, Pointer]

library.remagx_segmented_optics_prepare.argtypes = [Pointer, ctypes.c_size_t, Pointer, Pointer,
    ctypes.c_int, Pointer, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
library.remagx_segmented_optics_sample.argtypes = [ctypes.c_void_p, ctypes.c_double, Pointer, Pointer]
library.remagx_segmented_optics_destroy.argtypes = [ctypes.c_void_p]


def evaluate(layers, boundaries, tensors, model, position, samples, state=None):
    arrays = [(ctypes.c_double * len(values))(*values) for values in
              [[value for row in layers for value in row], boundaries, [value for row in tensors for value in row], samples]]
    scalar = (ctypes.c_double * 4)(*([-123]*4))
    tensor = (ctypes.c_double * 18)(*state) if state is not None else None
    before = [bytes(array) for array in arrays]
    status = library.remagx_segmented_optics(arrays[0], len(layers), arrays[1], arrays[2] if tensors else None,
        model, position, arrays[3], len(samples), scalar, tensor)
    assert before == [bytes(array) for array in arrays]
    if status:
        assert list(scalar) == [-123]*4
        assert tensor is None or list(tensor) == state
    return status, list(scalar), list(tensor) if tensor is not None else None


def cases():
    generator = random.Random(26038)
    result = []
    for case in range(60):
        count = 2 + case % 5
        layers = [[generator.uniform(0, 30), 0 if (case + index) % 5 == 0 else generator.uniform(.1, 8),
                   *[generator.uniform(-.01, .01) for _ in range(4)], 90, 90] for index in range(count)]
        boundaries = [0.]
        for row in layers[1:]:
            boundaries.append(boundaries[-1] + row[0])
        tensors = [[generator.uniform(-2, 2) for _ in range(18)] for _ in layers]
        positions = [-100, 0, *boundaries[1:-1], *[generator.uniform(-20, boundaries[-1] + 20) for _ in range(10)], 1000]
        result.append((layers, boundaries, tensors, case % 3, positions))
    return result


class SegmentedOpticsTest(unittest.TestCase):
    def test_owned_preparation_matches_one_shot_and_preserves_failure_outputs(self):
        samples = [math.erf(-5 + index * 10 / 999) for index in range(1001)]
        prepared_cases = cases()
        for layers, boundaries, tensors, model, positions in cases()[:3]:
            for row in layers:
                row[0] = 0.0
            prepared_cases.append((layers, [0.] * len(layers), tensors, model, positions))
        for layers, boundaries, tensors, model, positions in prepared_cases:
            for with_tensors in (False, True):
                inputs = [(ctypes.c_double * len(values))(*values) for values in
                          [[v for row in layers for v in row], boundaries,
                           [v for row in tensors for v in row], samples]]
                handle = ctypes.c_void_p()
                status = library.remagx_segmented_optics_prepare(inputs[0], len(layers), inputs[1],
                    inputs[2] if with_tensors else None, model, inputs[3], 1001, ctypes.byref(handle))
                self.assertEqual(status, 0)
                self.assertTrue(handle.value)
                # Destroy the source values after preparation: the handle owns its copy.
                for array in inputs:
                    for index in range(len(array)):
                        array[index] = math.nan
                state = [7.] * 18 if with_tensors else None
                try:
                    for position in positions:
                        expected = evaluate(layers, boundaries, tensors if with_tensors else [],
                                            model, position, samples, state)
                        output = (ctypes.c_double * 4)(*([-123.] * 4))
                        tensor = (ctypes.c_double * 18)(*state) if with_tensors else None
                        status = library.remagx_segmented_optics_sample(handle, position, output, tensor)
                        actual = (status, list(output), list(tensor) if tensor is not None else None)
                        self.assertEqual(actual, expected)
                        state = actual[2]
                    before = bytes(output), bytes(tensor) if tensor is not None else None
                    self.assertEqual(library.remagx_segmented_optics_sample(handle, math.nan, output, tensor), 1)
                    self.assertEqual((bytes(output), bytes(tensor) if tensor is not None else None), before)
                    self.assertEqual(library.remagx_segmented_optics_sample(handle, 0, None, tensor), 1)
                    if with_tensors:
                        tensor[0] = math.inf
                        before = bytes(output), bytes(tensor)
                        self.assertEqual(library.remagx_segmented_optics_sample(handle, 0, output, tensor), 1)
                        self.assertEqual((bytes(output), bytes(tensor)), before)
                    if not with_tensors:
                        invalid_state = (ctypes.c_double * 18)(*([7.] * 18))
                        self.assertEqual(library.remagx_segmented_optics_sample(handle, 0, output, invalid_state), 1)
                        self.assertEqual(list(invalid_state), [7.] * 18)
                finally:
                    library.remagx_segmented_optics_destroy(handle)
        handle = ctypes.c_void_p(123)
        self.assertEqual(library.remagx_segmented_optics_prepare(None, 0, None, None, 2, None, 0, ctypes.byref(handle)), 1)
        self.assertEqual(handle.value, 123)
        self.assertEqual(library.remagx_segmented_optics_sample(None, 0, None, None), 1)
        library.remagx_segmented_optics_destroy(None)

    def test_sharp_interfaces_global_replacement_and_local_accumulation(self):
        layers = [[0, 0, 2, 4, 6, 8, 90, 90], [100, 0, 4, 6, 8, 10, 90, 90]]
        samples = [(-5 + index*10/999)/5 for index in range(1001)]
        tensors = [[2]*18, [4]*18]
        for model in range(3):
            for position, expected in [(-100, [2, 4, 6, 8]), (0, [3, 5, 7, 9]), (100, [4, 6, 8, 10])]:
                status, scalar, tensor = evaluate(layers, [0, 100], tensors, model, position, samples, [7]*18)
                self.assertEqual(status, 0)
                for value, target in zip(scalar, expected):
                    self.assertAlmostEqual(value, target, delta=1e-14)
                for value in tensor:
                    self.assertAlmostEqual(value, expected[0] + (7 if model == 2 else 0), delta=1e-14)
        # All zero weights in model 0 keep the previous tensor, but reset scalars.
        status, scalar, tensor = evaluate(layers, [0, 0], tensors, 0, 100, samples, [7]*18)
        self.assertEqual((status, scalar, tensor), (0, [0]*4, [7]*18))

    def test_invalid_and_numerical_failure_leave_outputs_unchanged(self):
        layers = [[0, 1, 1, 2, 3, 4, 90, 90], [0, 1, 2, 3, 4, 5, 90, 90]]
        for model, position, samples in [(3, 0, [0]*1001), (0, math.inf, [0]*1001),
                                          (1, 0, [0]*1000), (2, 0, [math.nan]*1001)]:
            self.assertEqual(evaluate(layers, [0, 10], [], model, position, samples)[0], 1)
        self.assertEqual(evaluate(layers, [0, 10], [], 2, 0, [0]*1001, [7]*18)[0], 1)
        self.assertEqual(evaluate(layers, [0, 10], [[1e308]*18, [-1e308]*18], 2, 0, [0]*1001, [7]*18)[0], 2)
        layers[0][2] = 1e308; layers[1][2] = -1e308
        self.assertEqual(evaluate(layers, [0, 10], [], 2, 0, [0]*1001)[0], 2)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original optical sampler comparison not requested')
    def test_original_optical_samplers_with_private_table_and_reused_state(self):
        root = Path(os.environ['LEGACY_ROOT'])/'shared'
        raw = (root/'LayerSegmentation.cpp').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '5d7b1c3d0a5a784584f17fa49c92c1612569e362c2858d57b039da867e922e48')
        source = raw.decode('latin1').replace('\r\n', '\n')
        # Original lookup generation remains private in the temporary build.
        lookup = source[source.index('double gammln('):source.index('/*\nvoid LayerSegmentation3')]
        source = (root/'LayerSegmentation.h').read_text(encoding='latin1')
        start = source.index('template<class T>\nvoid GetOpticalConstant1(')
        methods = source[start:source.index('template<class T>\nvoid LayerSegmentation2(', start)]
        self.assertEqual(hashlib.sha256(methods.encode()).hexdigest(), 'f5c5802c6c2c7d22b04758e0de28a6c486910667652bdc3e3f2c1d29ead0f6e7')
        scaffold = r'''#include <cmath>
#include <vector>
#include <complex>
#include <iostream>
#include <iomanip>
using namespace std;
template<class T> struct CVector:vector<T>{using vector<T>::vector;using Iterator=typename vector<T>::iterator;};
template<class T> struct CMATRIX{complex<T> a[3][3]{};};
template<class T> struct Optical{T delta=0,beta=0,deltam=0,betam=0;CMATRIX<T> epsilon;};
template<class T> struct Schicht{T z=0,d=0,sigma=0;Optical<T> oc;};
void nrerror(const char*){}
'''
        wrapper = r'''int main(){erffinit();cout<<setprecision(17);for(double value:table)cout<<value<<' ';cout<<'\n';
int count,model,points;while(cin>>count>>model>>points){CVector<Schicht<double>> layers(count);Schicht<double> sample;
for(auto& row:layers)cin>>row.d>>row.sigma>>row.oc.delta>>row.oc.beta>>row.oc.deltam>>row.oc.betam;
for(auto& row:layers)cin>>row.z;
for(auto& row:layers)for(int i=0;i<3;++i)for(int j=0;j<3;++j){double re,im;cin>>re>>im;row.oc.epsilon.a[i][j]={re,im};}
for(int i=0;i<3;++i)for(int j=0;j<3;++j)sample.oc.epsilon.a[i][j]={.25,-.5};
for(int point=0;point<points;++point){double z;cin>>z;
if(model==0)GetOpticalConstant1(layers,sample,z,true);else if(model==1)GetOpticalConstant2(layers,sample,z,true);else GetOpticalConstant3(layers,sample,z,true);
cout<<sample.oc.delta<<' '<<sample.oc.beta<<' '<<sample.oc.deltam<<' '<<sample.oc.betam;
for(int i=0;i<3;++i)for(int j=0;j<3;++j)cout<<' '<<sample.oc.epsilon.a[i][j].real()<<' '<<sample.oc.epsilon.a[i][j].imag();cout<<'\n';}}}
'''
        prepared = cases()
        payload = '\n'.join(' '.join(map(str, [len(layers), model, len(positions),
            *[value for row in layers for value in row[:6]], *boundaries,
            *[value for row in tensors for value in row], *positions]))
            for layers, boundaries, tensors, model, positions in prepared)
        with tempfile.TemporaryDirectory(prefix='remagx-segmented-optics-') as temporary:
            cpp, exe = Path(temporary)/'reference.cpp', Path(temporary)/'reference'
            cpp.write_text(scaffold+lookup+methods+wrapper)
            subprocess.run(['g++','-std=c++17','-O2','-fno-fast-math','-ffp-contract=off',str(cpp),'-o',str(exe)], capture_output=True, check=True)
            lines = iter(subprocess.run([str(exe)], input=payload, capture_output=True, text=True, check=True).stdout.splitlines())
        samples = list(map(float, next(lines).split()))
        self.assertEqual(len(samples), 1001)
        comparisons = 0
        for layers, boundaries, tensors, model, positions in prepared:
            state = [.25,-.5]*9
            for position in positions:
                reference = list(map(float, next(lines).split()))
                status, scalar, state = evaluate(layers, boundaries, tensors, model, position, samples, state)
                self.assertEqual(status, 0)
                self.assertEqual(len(reference), 22)
                for value, target in zip(scalar+state, reference):
                    self.assertLessEqual(abs(value-target), 1e-15+1e-10*abs(target))
                    comparisons += 1
                # Tensor accumulation never changes the independent scalar calculation.
                self.assertEqual(evaluate(layers, boundaries, [], model, position, samples)[1], scalar)
        self.assertIsNone(next(lines, None))
        print(f'Original segmented optics: {comparisons} scalar/tensor values matched across {len(prepared)} stacks with retained sample state.')


if __name__ == '__main__':
    if '--wasm-payload' in sys.argv:
        # Analytic samples are test inputs, not a production erf policy.
        samples = [math.erf(-5.0 + index*10.0/999.0) for index in range(1001)]
        payload = []
        for layers, boundaries, tensors, model, positions in cases():
            state = [.25,-.5]*9
            expected = []
            for position in positions:
                status, scalar, state = evaluate(layers, boundaries, tensors, model, position, samples, state)
                assert status == 0
                expected.extend(scalar+state)
            payload.append(dict(kind='segmented-optics', layers=layers, boundaries=boundaries, tensors=tensors,
                model=model, positions=positions, errorSamples=samples, tensorState=[.25,-.5]*9, expected=expected))
        print(json.dumps(payload))
    else:
        unittest.main()
