import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

// Full numerical composition with original samples held only in memory. This is
// prepared synthetic-stack evidence, not full-project/corpus acceptance.
it.skipIf(!process.env.LEGACY_ROOT || !process.env.WASM_MODULE)('matches original full segmentation with actual WASM preparation', () => {
  const root = join(process.env.LEGACY_ROOT!, 'shared')
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
  const raw = readFileSync(join(root, 'LayerSegmentation.cpp'))
  expect(hash(raw)).toBe('5d7b1c3d0a5a784584f17fa49c92c1612569e362c2858d57b039da867e922e48')
  const lookupSource = raw.toString('latin1').replace(/\r\n/g, '\n')
  const lookup = lookupSource.slice(lookupSource.indexOf('double gammln('), lookupSource.indexOf('/*\nvoid LayerSegmentation3'))
  const source = readFileSync(join(root, 'LayerSegmentation.h'), 'latin1').replace(/\r\n?/g, '\n')
  const start = source.indexOf('template<class T>\nvoid GetOpticalConstant1(')
  const split = source.indexOf('template<class T>\nvoid LayerSegmentation2(', start)
  const samplers = source.slice(start, split), subdivision = source.slice(split, source.indexOf('\n\n#endif', split))
  expect(hash(samplers)).toBe('f5c5802c6c2c7d22b04758e0de28a6c486910667652bdc3e3f2c1d29ead0f6e7')
  expect(hash(subdivision)).toBe('cc03143fac58ce23553d6fe909381a927867225e29552e2c1bc478ce15e99089')
  const layerSource = readFileSync(join(root, 'schicht.h'), 'latin1').replace(/\r\n?/g, '\n')
  const constructorStart = layerSource.indexOf('\t\tSchicht()')
  const constructor = layerSource.slice(constructorStart, layerSource.indexOf('\n\t\t}', constructorStart) + '\n\t\t}'.length)
  expect(hash(constructor)).toBe('0a6f1dda2cd8550cf723f304ba76cf188dd5207445d31fbc4840ad8e5392a4a7')
  const depth = layerSource.match(/template<class T>\s*inline void ztod\(CVector<Schicht<T> > &mfs\)\s*\{[^}]+\}/)?.[0]
  if (!depth) throw new Error('Original depth conversion missing')
  expect(hash(depth)).toBe('9e328f1166cfa3e7e42573755c55eb0edc9145f9b2b9e75db758f3137b7aa218')
  const profileSource = readFileSync(join(root, 'CGaussFunc.h'), 'latin1').replace(/\r\n?/g, '\n')
  expect(hash(profileSource)).toBe('602ae8b0a3766fd5f36eff64734fd66f032289007d174ada841c0171a7e28bbf')
  const helper = readFileSync(join(root, 'RechenHilfe.h'), 'latin1').replace(/\r\n?/g, '\n')
  const densityStart = helper.lastIndexOf('template<class T>', helper.indexOf('T GetDensity(CVector<Schicht<T> >'))
  const application = helper.slice(densityStart, helper.indexOf('// --------------------------------------------------------------------', helper.indexOf('void CalcMagProfile(', densityStart)))
  expect(hash(application)).toBe('038e11fe5fd1f11418b221dd610b81fbdbb40f14adadb0072200940193468216')
  const scaffold = `#include <cmath>
#include <vector>
#include <complex>
#include <iostream>
#include <iomanip>
using namespace std;
class CDataSet;
const int ISOTROPIC=0,ANISOTROPIC=1;
template<class T>struct CVector:vector<T>{using vector<T>::vector;using Iterator=typename vector<T>::iterator;void clear_but_dont_destroy(){this->clear();}void Reserve(int n){this->reserve(n);}};
template<class T>struct CMATRIX{complex<T>a[4][4]{};};
template<class T>struct Optical{T delta=0,beta=0,deltam=0,betam=0;int epsilontype=0;CMATRIX<T>epsilon;};
template<class T>struct Schicht{T electron_escape_depth,electron_gain_function,density,d,z,sigma,maggamma,magphi;int ocindex;complex<T>n;Optical<T>oc;
${constructor}
};
void nrerror(const char*){}
`
  const main = `int main(){erffinit();cout<<setprecision(17);for(double value:table)cout<<value<<' ';cout<<'\\n';
int count,model,matrix,profileCount,additive;double minimum,maximum,scale;while(cin>>count>>model>>matrix>>minimum>>maximum>>scale>>profileCount>>additive){
CVector<Schicht<double>> layers(count),output;
for(auto& row:layers){cin>>row.d>>row.sigma>>row.oc.delta>>row.oc.beta>>row.oc.deltam>>row.oc.betam>>row.maggamma>>row.magphi>>row.oc.epsilontype;
for(int i=0;i<3;++i)for(int j=0;j<3;++j){double re,im;cin>>re>>im;row.oc.epsilon.a[i][j]={re,im};}}
for(int i=1;i<count;++i)layers[i].z=layers[i-1].z+layers[i].d;
CVector<CGaussFunc> profiles(profileCount);
for(auto& profile:profiles){int knots;cin>>profile.z>>profile.Var>>profile.delta>>profile.beta>>profile.bindtolayer>>knots;profile.usespline=knots>=0;
for(int i=0;i<knots;++i){double x,y;cin>>x>>y;profile.sf.Add(x,y);}}
if(profileCount){CSlicing slicing{1,model,minimum,maximum,scale};output=layers;CalcMagProfile(output,profiles,matrix,2,slicing,additive);}
else LayerSegmentation2(layers,matrix,model,minimum,maximum,scale,output);cout<<output.size();
for(auto& row:output){cout<<' '<<row.z<<' '<<row.d<<' '<<row.sigma<<' '<<row.oc.delta<<' '<<row.oc.beta<<' '<<row.oc.deltam<<' '<<row.oc.betam<<' '<<row.maggamma<<' '<<row.magphi;
if(matrix){cout<<' '<<row.oc.epsilontype;for(int i=0;i<3;++i)for(int j=0;j<3;++j)cout<<' '<<row.oc.epsilon.a[i][j].real()<<' '<<row.oc.epsilon.a[i][j].imag();}}
cout<<'\\n';}}
`
  const cases = Array.from({ length: 48 }, (_, index) => {
    const count = 3 + index % 3
    return {
      additive: Math.floor(index / 4) % 2 === 0,
      profiles: index < 24 ? [] : [null, 0, 1, count - 1].map((boundToLayer, profileIndex) => ({
        center: 2, width: 7 + profileIndex, deltaAmplitude: (profileIndex + 1) * 1e-5, betaAmplitude: -(profileIndex + 1) * 2e-5,
        boundToLayer, amplitudeCoupledTo: null, widthCoupledTo: null,
        spline: { enabled: profileIndex === 1, points: [-1000, -900, 900, 1000].map((z, knot) => ({ z, value: [.2, .8, .4, .9][knot] })) },
      })),
      matrix: index % 2 === 0,
      settings: { scope: index % 4 < 2 ? 'global' : 'local', minThickness: [.4, 1, 2][index % 3],
        maxThickness: [3, 5, 7][index % 3], gradientScale: [.1, 1, 0][index % 3], tolerance: 1e-6 },
      layers: Array.from({ length: count }, (_, layer) => [layer === 0 ? 999 : layer === count - 1 ? 777 : 3 + (index + layer) % 7,
        [0, 10, 11, 25][(index + layer) % 4], ...Array.from({ length: 4 }, (_, component) => (layer + 1) * (component + 1) * (index % 3 + 1) * 1e-5), 12 + layer, 34 + layer]),
      tensors: Array.from({ length: count }, (_, layer) => Array.from({ length: 18 }, (_, component) => (layer + 1) * (component + 1) / 100)),
      anisotropic: Array.from({ length: count }, (_, layer) => layer === [0, 1, count - 1, -1][Math.floor(index / 2) % 4]),
    }
  })
  const payload = cases.map(item => [item.layers.length, item.settings.scope === 'global' ? 1 : 2, Number(item.matrix),
    item.settings.minThickness, item.settings.maxThickness, item.settings.gradientScale, item.profiles.length, Number(item.additive),
    ...item.layers.flatMap((layer, index) => [...layer, Number(item.anisotropic[index]), ...item.tensors[index]]),
    ...item.profiles.flatMap(profile => [profile.center, profile.width, profile.deltaAmplitude, profile.betaAmplitude,
      profile.boundToLayer ?? -1, profile.spline.enabled ? profile.spline.points.length : -1,
      ...(profile.spline.enabled ? profile.spline.points.flatMap(point => [point.z, point.value]) : [])])].join(' ')).join('\n') + '\n'
  const directory = mkdtempSync(join(tmpdir(), 'remagx-segmentation-reference-'))
  try {
    const path = join(directory, 'reference.cpp'), binary = join(directory, 'reference')
    writeFileSync(path, scaffold + profileSource.replace('#include"CVector.h"', '').replaceAll('LinInterpolation', 'ProfileLinInterpolation') + lookup + depth + samplers + subdivision +
      'struct CSlicing{int layersegmentationmode,segmentationmodel;double minlayerthickness,maxlayerthickness,gradientscale;};\n' + application + main)
    const build = spawnSync('g++', ['-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', path, '-o', binary], { encoding: 'utf8', timeout: 30000 })
    if (build.status !== 0) throw new Error('Private segmentation reference compilation failed; diagnostics withheld')
    const run = spawnSync(binary, [], { input: payload, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 })
    if (run.status !== 0) throw new Error('Private segmentation reference execution failed; diagnostics withheld')
    const lines = run.stdout.trim().split('\n')
    const samples = lines.shift()!.trim().split(/\s+/).map(Number)
    expect(samples.length).toBe(1001)
    expect(samples.every(Number.isFinite)).toBe(true)
    expect(lines.length).toBe(cases.length)
    const prepared = cases.map((item, index) => {
      const [count, ...expected] = lines[index].trim().split(/\s+/).map(Number)
      expect(Number.isInteger(count) && count > 0 && count <= 10000).toBe(true)
      expect(expected.every(Number.isFinite)).toBe(true)
      expect(expected.length).toBe(count * (item.matrix ? 28 : 9))
      return { ...item, count, expected }
    })
    let result: { cases: number; layers: number; values: number }
    try {
      result = JSON.parse(execFileSync('node', ['--experimental-strip-types', resolve('scripts/compare-segmentation-preparation.mjs'), resolve(process.env.WASM_MODULE!)],
        { input: JSON.stringify({ samples, cases: prepared }), timeout: 60000, maxBuffer: 1024 * 1024, stdio: 'pipe' }).toString())
    } catch { throw new Error('Original full-segmentation WASM comparison failed; private diagnostics withheld') }
    expect(result.cases).toBe(cases.length)
    expect(result.layers).toBe(prepared.reduce((sum, item) => sum + item.count, 0))
    expect(result.values).toBe(prepared.reduce((sum, item) => sum + item.expected.length, 0))
    process.stdout.write(`Original full segmentation: ${result.cases} stacks, ${result.layers} layers, ${result.values} values matched in WASM preparation.\n`)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 90000)
