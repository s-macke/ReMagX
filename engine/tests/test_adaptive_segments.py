import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

library = ctypes.CDLL(sys.argv.pop(1))
Pointer = ctypes.POINTER(ctypes.c_double)
Sampler = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_double, ctypes.c_size_t, Pointer, ctypes.c_void_p)
library.remagx_adaptive_segments.argtypes = [ctypes.c_double]*5 + [ctypes.c_size_t, Sampler,
    ctypes.c_void_p, ctypes.c_size_t, Pointer, Pointer, Pointer, ctypes.POINTER(ctypes.c_size_t)]


def optical(position, component):
    return ((component + 1)*1e-7) * (position*position + .25*position + 2)


def evaluate(start=-30, end=47, minimum=.3, maximum=5, scale=.2, width=4, capacity=10000, callback=None, stateful=False):
    trace = []
    states = [[0.]*18 for _ in range(4)]
    def sample(position, slot, output, _context):
        trace.append((position, slot))
        if callback:
            return callback(position, output, len(trace))
        for component in range(width):
            value = optical(position, component)
            if stateful and component >= 4:
                states[slot][component - 4] += value
                value = states[slot][component - 4]
            output[component] = value
        return 0
    positions = (ctypes.c_double * capacity)(*([-123]*capacity))
    thickness = (ctypes.c_double * capacity)(*([-123]*capacity))
    values = (ctypes.c_double * (capacity*width))(*([-123]*(capacity*width)))
    count = ctypes.c_size_t(123)
    status = library.remagx_adaptive_segments(start, end, minimum, maximum, scale, width,
        Sampler(sample), None, capacity, positions, thickness, values, ctypes.byref(count))
    if status:
        assert count.value == 123
        assert all(value == -123 for array in [positions, thickness, values] for value in array)
        return status, [], trace
    return status, [[positions[index], thickness[index], *values[index*width:(index+1)*width]]
                    for index in range(count.value)], trace


class AdaptiveSegmentsTest(unittest.TestCase):
    def test_constant_samples_and_final_resampling(self):
        def constant(position, output, _call):
            for component in range(4):
                output[component] = component + 1
            return 0
        status, rows, trace = evaluate(start=0, end=4, minimum=1, maximum=2, callback=constant)
        self.assertEqual(status, 0)
        self.assertEqual(rows, [[1, 0, 1, 2, 3, 4], [3, 2, 1, 2, 3, 4], [5, 2, 1, 2, 3, 4]])
        self.assertEqual(trace[-2:], [(2, 0), (4, 0)])
        self.assertEqual([slot for _, slot in trace], [0, 1, 2, 3]*3 + [0, 0])
        self.assertEqual(len(trace), 14)
        # Zero scale chooses minimum step; zero gradient with nonzero scale chooses maximum.
        self.assertEqual(len(evaluate(start=0, end=4, minimum=1, maximum=2, scale=0, callback=constant)[1]), 5)

    def test_invalid_callbacks_limits_and_late_failures_are_atomic(self):
        for change in [dict(minimum=0), dict(maximum=.1), dict(start=math.nan), dict(end=-31),
                       dict(scale=math.inf), dict(width=5)]:
            self.assertEqual(evaluate(**change)[0], 1)
        self.assertEqual(evaluate(capacity=1)[0], 1)
        self.assertEqual(evaluate(start=1e20, end=1e20, minimum=.1, maximum=.2)[0], 2)
        for fail_at in [1, 4, 13]:
            def broken(position, output, call):
                for component in range(4):
                    output[component] = 1
                return 1 if call == fail_at else 0
            self.assertEqual(evaluate(start=0, end=4, minimum=1, maximum=2, callback=broken)[0], 2)
        def incomplete(_position, output, _call):
            output[0] = 1
            return 0
        self.assertEqual(evaluate(callback=incomplete)[0], 2)
        self.assertEqual(evaluate()[0], 0)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original subdivision comparison not requested')
    def test_original_subdivision_with_controlled_optical_sampler(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/LayerSegmentation.h').read_text(encoding='latin1')
        start = source.index('template<class T>\nvoid LayerSegmentation2(', source.index('void GetOpticalConstant3'))
        method = source[start:source.index('\n\n#endif', start)]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(), 'cc03143fac58ce23553d6fe909381a927867225e29552e2c1bc478ce15e99089')
        scaffold = r'''#include <cmath>
#include <vector>
#include <complex>
#include <iostream>
#include <iomanip>
using namespace std;
const int ISOTROPIC=0, ANISOTROPIC=1;
template<class T> struct CVector:vector<T>{using vector<T>::vector;void clear_but_dont_destroy(){this->clear();}void Reserve(int n){this->reserve(n);}};
template<class T> struct Matrix{complex<T> a[3][3]{};};
template<class T> struct Optical{T delta=0,beta=0,deltam=0,betam=0;int epsilontype=0;Matrix<T> epsilon;};
template<class T> struct Schicht{T z=0,d=0,sigma=0;Optical<T> oc;};
template<class T> void ztod(CVector<Schicht<T>>& rows){for(size_t i=1;i<rows.size();++i)rows[i].d=rows[i].z-rows[i-1].z;}
double value(double z,int c){return ((c+1)*1e-7)*(z*z+.25*z+2);}
template<class T> void GetOpticalConstant1(CVector<Schicht<T>>&,Schicht<T>& s,T z,bool matrix){
s.z=z;s.sigma=0;s.oc.delta=value(z,0);s.oc.beta=value(z,1);s.oc.deltam=value(z,2);s.oc.betam=value(z,3);
if(matrix)for(int i=0;i<3;++i)for(int j=0;j<3;++j)s.oc.epsilon.a[i][j]={value(z,4+2*(i*3+j)),value(z,5+2*(i*3+j))};}
template<class T> void GetOpticalConstant2(CVector<Schicht<T>>& a,Schicht<T>& b,T z,bool m){GetOpticalConstant1(a,b,z,m);}
template<class T> void GetOpticalConstant3(CVector<Schicht<T>>& a,Schicht<T>& b,T z,bool m){
auto previous=b.oc.epsilon;GetOpticalConstant1(a,b,z,m);
if(m)for(int i=0;i<3;++i)for(int j=0;j<3;++j)b.oc.epsilon.a[i][j]+=previous.a[i][j];}
'''
        wrapper = r'''int main(){cout<<setprecision(17);int model,matrix;double minimum,maximum,scale;
while(cin>>model>>matrix>>minimum>>maximum>>scale){CVector<Schicht<double>> input(3),output;input[1].d=17;
LayerSegmentation2(input,matrix,model,minimum,maximum,scale,output);cout<<output.size()<<'\n';
for(auto& row:output){cout<<row.z<<' '<<row.d<<' '<<row.oc.delta<<' '<<row.oc.beta<<' '<<row.oc.deltam<<' '<<row.oc.betam;
if(matrix)for(int i=0;i<3;++i)for(int j=0;j<3;++j)cout<<' '<<row.oc.epsilon.a[i][j].real()<<' '<<row.oc.epsilon.a[i][j].imag();cout<<'\n';}}}
'''
        cases = [(model, matrix, minimum, maximum, scale) for model in range(3) for matrix in [0, 1]
                 for minimum, maximum, scale in [(.3, 5, .2), (.2, 3, 2), (1, 4, 0), (.7, .7, -1)]]
        with tempfile.TemporaryDirectory(prefix='remagx-subdivision-') as temporary:
            cpp, exe = Path(temporary)/'reference.cpp', Path(temporary)/'reference'
            cpp.write_text(scaffold + method + wrapper)
            subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(cpp), '-o', str(exe)], capture_output=True, check=True)
            lines = iter(subprocess.run([str(exe)], input='\n'.join(' '.join(map(str, case)) for case in cases),
                capture_output=True, text=True, check=True).stdout.splitlines())
        compared = 0
        for model, matrix, minimum, maximum, scale in cases:
            count = int(next(lines))
            expected = [list(map(float, next(lines).split())) for _ in range(count)]
            status, rows, _ = evaluate(minimum=minimum, maximum=maximum, scale=scale, width=22 if matrix else 4, stateful=model == 2)
            self.assertEqual(status, 0)
            self.assertEqual(len(rows), count)
            for actual, reference in zip(rows, expected):
                self.assertEqual(len(actual), len(reference))
                for value, target in zip(actual, reference):
                    self.assertLessEqual(abs(value-target), 1e-15 + 1e-10*abs(target))
                    compared += 1
        self.assertIsNone(next(lines, None))
        print(f'Original adaptive subdivision: {compared} positions, thicknesses and optical values matched across {len(cases)} cases.')

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original local sampler comparison not requested')
    def test_original_local_sampler_retains_tensor_but_resets_scalars(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/LayerSegmentation.h').read_text(encoding='latin1')
        start = source.index('template<class T>\nvoid GetOpticalConstant3(')
        method = source[start:source.index('template<class T>\nvoid LayerSegmentation2(', start)]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(), '11055cf3f2b3898d5779eff6c79243e063b9c410aac0d65a602139ea66c14ce0')
        scaffold = r'''#include <cmath>
#include <complex>
#include <vector>
#include <iostream>
#include <iomanip>
using namespace std;
template<class T> using CVector=vector<T>;
template<class T> struct Matrix{complex<T> a[3][3]{};};
template<class T> struct Optical{T delta=0,beta=0,deltam=0,betam=0;Matrix<T> epsilon;};
template<class T> struct Schicht{T z=0,d=0,sigma=0;Optical<T> oc;};
// Controlled lookup isolates the original sampler's mutable output semantics.
double erfftable(double){return 0;}
'''
        wrapper = r'''int main(){cout<<setprecision(17);CVector<Schicht<double>> layers(2);Schicht<double> sample;
layers[0].oc.delta=.2;layers[1].oc.delta=.4;layers[0].oc.beta=.1;layers[1].oc.beta=.3;
for(int layer=0;layer<2;++layer)for(int i=0;i<3;++i)for(int j=0;j<3;++j)
layers[layer].oc.epsilon.a[i][j]={double(1+2*layer+i*3+j),double(2+2*layer+i*3+j)};
for(int repeat=0;repeat<3;++repeat){GetOpticalConstant3(layers,sample,0.,true);
cout<<sample.oc.delta<<' '<<sample.oc.beta;
for(int i=0;i<3;++i)for(int j=0;j<3;++j)cout<<' '<<sample.oc.epsilon.a[i][j].real()<<' '<<sample.oc.epsilon.a[i][j].imag();cout<<'\n';}}
'''
        with tempfile.TemporaryDirectory(prefix='remagx-local-state-') as temporary:
            cpp, exe = Path(temporary)/'reference.cpp', Path(temporary)/'reference'
            cpp.write_text(scaffold + method + wrapper)
            subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(cpp), '-o', str(exe)], capture_output=True, check=True)
            rows = [list(map(float, line.split())) for line in subprocess.run([str(exe)], capture_output=True,
                text=True, check=True).stdout.splitlines()]
        self.assertEqual(len(rows), 3)
        for repeat, row in enumerate(rows, 1):
            self.assertAlmostEqual(row[0], .3, delta=1e-15)
            self.assertAlmostEqual(row[1], .2, delta=1e-15)
            self.assertEqual(row[2:], [repeat * value for entry in range(9) for value in [2 + entry, 3 + entry]])


if __name__ == '__main__':
    if '--wasm-payload' in sys.argv:
        payload = []
        for width in [4, 22]:
            for minimum, maximum, scale in [(.3, 5, .2), (.2, 3, 2), (1, 4, 0), (.7, .7, -1)]:
                status, rows, _ = evaluate(minimum=minimum, maximum=maximum, scale=scale, width=width)
                assert status == 0
                payload.append(dict(kind='adaptive', minimumDepth=-30, maximumDepth=47,
                    minimumStep=minimum, maximumStep=maximum, gradientScale=scale,
                    valueCount=width, capacity=10000, expected=[value for row in rows for value in row]))
        # Slot-specific accumulation models the real local sampler's retained tensor state.
        status, rows, _ = evaluate(width=22, stateful=True)
        assert status == 0
        payload.append(dict(kind='adaptive', minimumDepth=-30, maximumDepth=47,
            minimumStep=.3, maximumStep=5, gradientScale=.2, valueCount=22, capacity=10000,
            stateful=True, expected=[value for row in rows for value in row]))
        print(json.dumps(payload))
    else:
        unittest.main()
