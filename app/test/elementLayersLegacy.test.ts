import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { createDefaultProject } from '../src/model/defaults'
import { prepareElementLayers } from '../src/model/elementLayers'
import { HC_EV_ANGSTROM } from '../src/model/units'

it.skipIf(!process.env.LEGACY_ROOT)('matches original Element2Material orchestration with an isolated optical sampler', () => {
  const source = readFileSync(join(process.env.LEGACY_ROOT!, 'shared/RechenHilfe.h'), 'latin1').replace(/\r\n?/g, '\n')
  const start = source.indexOf('void Element2Material(', source.indexOf('void inline Element2oc('))
  const end = source.indexOf('int CalcReflectivityEnergyResolution(', start)
  const method = source.slice(source.lastIndexOf('template<class T>', start), source.lastIndexOf('template<class T>', end))
  expect(createHash('sha256').update(method).digest('hex')).toBe('c87618b74ec123730489c621859aa62184d5e73d34787b427bb9c177387a0991')
  const layerSource = readFileSync(join(process.env.LEGACY_ROOT!, 'shared/schicht.h'), 'latin1').replace(/\r\n?/g, '\n')
  const depthMethod = layerSource.match(/template<class T>\s*inline void ztod\(CVector<Schicht<T> > &mfs\)\s*\{[^}]+\}/)?.[0]
  if (!depthMethod) throw new Error('Private depth conversion method missing')
  expect(createHash('sha256').update(depthMethod).digest('hex')).toBe('9e328f1166cfa3e7e42573755c55eb0edc9145f9b2b9e75db758f3137b7aa218')
  const scaffold = `#include <vector>
#include <cmath>
#include <iostream>
#include <iomanip>
using namespace std;
enum { ELEMENT=1 };
template<class T> struct CVector:vector<T>{void clear_but_dont_destroy(){this->clear();}void Reserve(int n){this->reserve(n);}T& last(){return this->back();}};
struct Slab{double d,sigma;};struct Element{CVector<Slab> mfs;};struct CFilm{int mode=ELEMENT;CVector<Element> el;};
struct CStateHandler{CFilm film;double maggamma=12,magphi=34;struct{double minlayerthickness,segmentationerror;}slicing;struct{double energy;double LambdaToEnergy()const{return energy;}}Var;const CFilm* GetActiveFilm()const{return &film;}};
template<class T>struct CDeltaBeta{T delta,beta,deltam,betam;};
template<class T>struct Schicht{T z=0,d=0,maggamma=90,magphi=90;CDeltaBeta<T> oc;};
template<class T>void Element2oc(const T& z,const T& factor,const CStateHandler&,const CStateHandler&,CDeltaBeta<T>& o){o.delta=z*.001*factor;o.beta=z*z*.0001*factor;o.deltam=z*.0002*factor;o.betam=0;}
`
  const main = `int main(){CStateHandler s;int n;while(cin>>s.slicing.minlayerthickness>>s.slicing.segmentationerror>>s.Var.energy>>n){s.film.el.resize(n);for(auto& e:s.film.el){int k;cin>>k;e.mfs.resize(k);for(auto& l:e.mfs)cin>>l.d>>l.sigma;}CVector<Schicht<double>> rows;Element2Material(s,s,rows);cout<<rows.size()<<setprecision(17);for(auto l:rows)cout<<' '<<l.z<<' '<<l.d<<' '<<l.oc.delta<<' '<<l.oc.beta<<' '<<l.oc.deltam<<' '<<l.oc.betam;cout<<'\\n';}}`
  const projects = Array.from({ length: 40 }, (_, index) => {
    const project = createDefaultProject(); project.sample.mode = 'element'
    project.experiment.energy = 100 + index * 37
    project.calculation.segmentation.minThickness = [.25, 1, 3, 7][index % 4]
    project.calculation.segmentation.tolerance = [0, 1e-8, 1e-6, 1][index % 4]
    project.sample.elementProfiles = Array.from({ length: index % 4 }, (_, element) => ({
      element: 'Fe', f1: 0, f2: 0, f1Mag: 0, f2Mag: 0,
      slabs: [0, 3 + index % 9, 0].map(thickness => ({ thickness, density: 1, roughness: element + 1 })),
    }))
    return project
  })
  const payload = projects.map(project => [project.calculation.segmentation.minThickness, project.calculation.segmentation.tolerance,
    HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy), project.sample.elementProfiles.length,
    ...project.sample.elementProfiles.flatMap(element => [element.slabs.length, ...element.slabs.flatMap(slab => [slab.thickness, slab.roughness])])].join(' ')).join('\n') + '\n'
  const directory = mkdtempSync(join(tmpdir(), 'remagx-element-reference-'))
  try {
    const path = join(directory, 'reference.cpp'), binary = join(directory, 'reference')
    writeFileSync(path, scaffold + depthMethod + method + main)
    const build = spawnSync('g++', ['-std=c++17', '-O2', '-ffp-contract=off', path, '-o', binary], { encoding: 'utf8' })
    if (build.status !== 0) throw new Error('Private element reference compilation failed')
    const run = spawnSync(binary, [], { input: payload, encoding: 'utf8' })
    if (run.status !== 0) throw new Error('Private element reference execution failed')
    const lines = run.stdout.trim().split('\n')
    expect(lines.length).toBe(projects.length)
    projects.forEach((project, index) => {
      let depth = -30
      const actual = prepareElementLayers(project, () => 1, ({ factor }) => {
        const z = depth; depth += project.calculation.segmentation.minThickness
        return { opticalConstants: new Float64Array([z * .001 * factor, z * z * .0001 * factor, z * .0002 * factor, 0]), dielectricTensor: null }
      })
      const [count, ...reference] = lines[index].split(' ').map(Number)
      expect(actual.layers.length).toBe(count)
      const values = actual.layers.flatMap((layer, i) => [actual.positions[i], layer[0], ...layer.slice(2, 6)])
      expect(values.length).toBe(reference.length)
      values.forEach((value, i) => expect(Math.abs(value - reference[i])).toBeLessThanOrEqual(1e-15 + 1e-10 * Math.abs(reference[i])))
    })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
