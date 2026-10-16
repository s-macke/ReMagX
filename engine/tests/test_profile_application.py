import ctypes
import hashlib
import math
import os
from pathlib import Path
import random
import subprocess
import tempfile
import unittest
import test_gaussian_profile as base

Profile, library, Pointer = base.Profile, base.library, base.Pointer
library.remagx_apply_gaussian_profiles.argtypes = [ctypes.POINTER(Profile), ctypes.c_size_t,
    Pointer, Pointer, Pointer, ctypes.c_size_t, ctypes.c_int, Pointer]

def evaluate(profiles, positions, initial, weights, coupled):
    packed = (Profile * len(profiles))(*profiles) if profiles else None
    points = (ctypes.c_double * len(positions))(*positions)
    baseline = (ctypes.c_double * len(initial))(*initial)
    binding = (ctypes.c_double * len(weights))(*weights) if profiles else None
    output = (ctypes.c_double * len(initial))(*([-123.] * len(initial)))
    inputs = [value for value in [packed, points, baseline, binding] if value is not None]
    before = [bytes(value) for value in inputs]
    status = library.remagx_apply_gaussian_profiles(packed, len(profiles), points, baseline, binding,
        len(positions), coupled, output)
    assert before == [bytes(value) for value in inputs]
    return status, list(output)

class ProfileApplicationTest(unittest.TestCase):
    def test_order_weights_and_atomic_errors(self):
        profiles = [Profile(0, 1, 2, 3), Profile(0, 1, 4, 5)]
        self.assertEqual(evaluate(profiles, [0], [10, 20], [1, .5], 0), (0, [14, 25.5]))
        self.assertEqual(evaluate(profiles, [0], [10, 20], [1, .5], 1), (0, [90, 280]))
        self.assertEqual(evaluate([], [0], [10, 20], [], 1), (0, [10, 20]))
        self.assertEqual(evaluate(profiles, [0], [10, 20], [0, 0], 1), (0, [10, 20]))
        self.assertEqual(evaluate(profiles, [0], [10, 20], [1, math.nan], 1), (1, [-123]*2))
        self.assertEqual(evaluate(profiles, [0], [10, 20], [1, 1], 2), (1, [-123]*2))
        overflowing = [Profile(0, 1e308, 1, 1)]
        self.assertEqual(evaluate(overflowing, [0, 1e308], [1]*4, [1, 1], 0), (2, [-123]*4))
        self.assertEqual(evaluate(overflowing, [0, 1e308], [1]*4, [1, 0], 0), (0, [2, 2, 1, 1]))
        overflowing[0].delta_amplitude = overflowing[0].beta_amplitude = 0
        self.assertEqual(evaluate(overflowing, [1e308], [1, 1], [1], 0), (0, [1, 1]))

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original application not requested')
    def test_original_application(self):
        root = Path(os.environ['LEGACY_ROOT']) / 'shared'
        header = (root / 'CGaussFunc.h').read_text(encoding='latin1')
        self.assertEqual(hashlib.sha256(header.encode()).hexdigest(), '602ae8b0a3766fd5f36eff64734fd66f032289007d174ada841c0171a7e28bbf')
        header = header.replace('#include"CVector.h"', '#include <vector>\ntemplate<class T> using CVector = std::vector<T>;')
        source = (root / 'RechenHilfe.h').read_text(encoding='latin1')
        start = source.rindex('template<class T>\nvoid CalcMagProfile(')
        method = source[start:source.index('// --------------------------------------------------------------------', start)]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(), '23de3800d3c068345f209c7e8887eeae1457234e6b4c3b2cab817bb76bedd369')
        # Segmentation is identity; binding returns supplied synthetic weights.
        # This reference isolates application and does not validate either stub.
        scaffold = r'''
#include <iostream>
#include <iomanip>
template<class T> struct Schicht {T z;struct {T deltam,betam;} oc;};
struct CSlicing {int layersegmentationmode=1,segmentationmodel=0;double minlayerthickness=1,maxlayerthickness=1,gradientscale=1;};
vector<double> binding;int profile_count;
template<class T> void LayerSegmentation2(CVector<Schicht<T>>&,bool,int,T,T,T,CVector<Schicht<T>>&) {}
template<class T> T GetDensity(CVector<Schicht<T>>& layers,int layer,T position) {
return binding[int(position)*profile_count+int(layers.size())-layer-1];}
'''
        wrapper = r'''
int main(){int count,coupled;cout<<setprecision(17);
while(cin>>profile_count>>count>>coupled){CVector<CGaussFunc> profiles(profile_count);
for(int j=0;j<profile_count;++j){auto& p=profiles[j];cin>>p.z>>p.Var>>p.delta>>p.beta;p.bindtolayer=j;}
CVector<Schicht<double>> layers(count+1);layers[0].z=0;
for(int i=1;i<=count;++i){layers[i].z=i;cin>>layers[i].oc.deltam>>layers[i].oc.betam;}
binding.resize(count*profile_count);for(auto& value:binding)cin>>value;
CalcMagProfile(layers,profiles,false,2,CSlicing(),!coupled);
for(int i=1;i<=count;++i)cout<<layers[i].oc.deltam<<' '<<layers[i].oc.betam<<' ';cout<<'\n';}}
'''
        generator = random.Random(26034)
        cases = []
        for number in range(120):
            profiles = [Profile(generator.uniform(-2, 10), generator.uniform(.2, 4),
                generator.uniform(-2, 2), generator.uniform(-2, 2)) for _ in range(4)]
            if number % 5 == 0: profiles[0].width = 0
            if number % 7 == 0: profiles[1].delta_amplitude = profiles[1].beta_amplitude = 0
            initial = [generator.uniform(-.01, .01) for _ in range(16)]
            weights = [0 if index % 5 == 0 else generator.uniform(-.2, 1.2) for index in range(32)]
            for coupled in [0, 1]: cases.append((profiles, [index+.5 for index in range(8)], initial, weights, coupled))
        payload = []
        for profiles, positions, initial, weights, coupled in cases:
            values = [len(profiles), len(positions), coupled]
            values.extend(getattr(profile, field) for profile in profiles for field, _ in Profile._fields_)
            payload.append(' '.join(map(str, values + initial + weights)))
        with tempfile.TemporaryDirectory(prefix='remagx-profile-application-') as temporary:
            cpp, exe = Path(temporary) / 'reference.cpp', Path(temporary) / 'reference'
            cpp.write_text(header + scaffold + method + wrapper)
            subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(cpp), '-o', str(exe)], check=True, capture_output=True)
            lines = subprocess.run([str(exe)], input='\n'.join(payload), text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(lines), len(cases))
        for arguments, line in zip(cases, lines):
            status, actual = evaluate(*arguments)
            self.assertEqual(status, 0)
            expected = list(map(float, line.split()))
            self.assertEqual(len(actual), len(expected))
            for value, reference in zip(actual, expected):
                self.assertLessEqual(abs(value-reference), 1e-15+1e-10*abs(reference))
        print('Original prepared Gaussian application: 3,840 magnetic values matched.')

if __name__ == '__main__':
    unittest.main()
