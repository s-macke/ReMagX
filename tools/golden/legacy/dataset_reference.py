"""Run only the reviewed private dataset adaptation/postprocessing methods on synthetic JSON."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

source = (Path(os.environ['LEGACY_ROOT']) / 'shared/CDataSet.h').read_text(encoding='latin1')
if hashlib.sha256(source.encode()).hexdigest() != '872ed4b90a2973969ec5981d77f184e35c30f9951658a00a27c6b5450b18ffe4':
    raise RuntimeError('Legacy dataset source changed; review required')
methods = []
for signature in ['void Adapt(double qzshift,', 'void inline MovingAverage(', 'double inline ToTheta(', 'void PostModifications(']:
    start = source.index(signature)
    brace = source.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    methods.append(source[start:end])
scaffold = '''#include <vector>
#include <cmath>
#include <iostream>
#include <iomanip>
#include <stdexcept>
using namespace std;
constexpr int NORMED=0;
struct Variablen {static double EnergyTok0(double energy){return 2.*3.14159265358979323846/(12398.326/energy);}};
struct Polarization {bool first,second;bool IsPi1(){return first;}bool IsPi2(){return second;}};
struct CDataSet {vector<double> qz,eng,R,Rp,Rm,A,tey;double energy;Polarization polarization;
void FFT(){throw runtime_error("FFT is outside this reference");}
'''+ '\n'.join(methods) + '''};
int main(){cout<<setprecision(17);double qshift,eshift,scale,offset;int multiply,divide,average,definition;
CDataSet data;while(cin>>data.energy>>qshift>>eshift>>scale>>offset>>multiply>>divide>>average>>definition>>data.polarization.first>>data.polarization.second){
vector<double>* columns[]={&data.qz,&data.eng,&data.R,&data.Rp,&data.Rm,&data.A,&data.tey};
for(auto column:columns){size_t count;cin>>count;column->resize(count);for(auto& value:*column)cin>>value;}
data.Adapt(qshift,eshift,scale,offset);data.PostModifications(multiply,divide,0,average,definition);
for(auto column:columns){cout<<column->size()<<' ';for(auto value:*column)cout<<value<<' ';}cout<<'\\n';}}
'''
keys = ['qz', 'energy', 'reflectivity', 'reflectivityPlus', 'reflectivityMinus', 'asymmetry', 'electronYield']
cases = json.load(sys.stdin)
payload = []
for case in cases:
    data, calculation = case['dataset'], case['calculation']
    def pure_pi(beam):
        return beam['sigma'] == dict(re=0, im=0) and beam['pi'] == dict(re=1, im=0)
    values = [data['energy'], data['qzShift'], data['energyShift'], data['intensityScale'], data['intensityOffset'],
              int(calculation['postProcessing']['multiplyByQz4']), int(calculation['postProcessing']['divideByCos2ThetaSquared']),
              calculation['averaging'], int(calculation['asymmetryDefinition'] != 'normalized'),
              int(pure_pi(data['polarization']['beam1'])), int(pure_pi(data['polarization']['beam2']))]
    for key in keys:
        column = data['columns'].get(key, [])
        values.extend([len(column), *column])
    payload.append(' '.join(map(str, values)))
with tempfile.TemporaryDirectory(prefix='remagx-dataset-') as temporary:
    directory = Path(temporary)
    (directory/'reference.cpp').write_text(scaffold)
    subprocess.run(['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', str(directory/'reference.cpp'),
                    '-o', str(directory/'reference')], capture_output=True, check=True)
    lines = subprocess.run([str(directory/'reference')], input='\n'.join(payload), text=True, capture_output=True, check=True).stdout.splitlines()
if len(lines) != len(cases): raise RuntimeError('Reference result count mismatch')
results = []
for case, line in zip(cases, lines):
    values = iter(line.split()); result = {}
    for key in keys:
        count = int(next(values)); column = [float(next(values)) for _ in range(count)]
        if key in case['dataset']['columns']: result[key] = column
    results.append(result)
print(json.dumps(results, allow_nan=False))
