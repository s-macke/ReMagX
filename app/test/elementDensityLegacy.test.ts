import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { createElementDensitySampler } from '../src/model/elementDensity'
import type { Project } from '../src/model/project'

it.skipIf(!process.env.LEGACY_ROOT)('matches original density weighting with a controlled lookup, without validating erf itself', () => {
  const source = readFileSync(join(process.env.LEGACY_ROOT!, 'shared/schicht.h'), 'latin1').replace(/\r\n?/g, '\n')
  const start = source.indexOf('double GetDensity(double z) const')
  const end = source.indexOf('\n};', start)
  const method = source.slice(start, end).trim()
  expect(createHash('sha256').update(method).digest('hex')).toBe('c721b3ba7f724dad5e4a26b149d43461a7d8d3dbb57ead934c86afb0d8720567')
  // This rational lookup is a test double, never a production erf replacement.
  const scaffold = `#include <vector>
#include <cmath>
#include <iostream>
#include <iomanip>
using namespace std;vector<double> calls;
double erfftable(double x){calls.push_back(x);return x/(1+fabs(x));}
struct Slab{double d,sigma,density;};struct Element{vector<Slab> mfs;
`
  const main = `};int main(){int count;double z;while(cin>>count>>z){Element e;e.mfs.resize(count);for(auto& s:e.mfs)cin>>s.d>>s.sigma>>s.density;calls.clear();double result=e.GetDensity(z);cout<<setprecision(17)<<result;for(double x:calls)cout<<' '<<x;cout<<'\\n';}}`
  const cases = Array.from({ length: 120 }, (_, index) => {
    const profile: Project['sample']['elementProfiles'][number] = { element: 'Fe', f1: 0, f2: 0, f1Mag: 0, f2Mag: 0,
      slabs: Array.from({ length: 2 + index % 6 }, (_, slab) => ({ thickness: (index + slab) % 13,
        roughness: (index * 3 + slab) % 5, density: (index - slab) / 7 })) }
    return [-30, -.01, 0, 3.5, 40].map(depth => ({ profile, depth }))
  }).flat()
  const payload = cases.map(({ profile, depth }) => [profile.slabs.length, depth,
    ...profile.slabs.flatMap(slab => [slab.thickness, slab.roughness, slab.density])].join(' ')).join('\n') + '\n'
  const directory = mkdtempSync(join(tmpdir(), 'remagx-density-reference-'))
  try {
    const path = join(directory, 'reference.cpp'), binary = join(directory, 'reference')
    writeFileSync(path, scaffold + method + main)
    if (spawnSync('g++', ['-std=c++17', '-O2', '-ffp-contract=off', path, '-o', binary], { encoding: 'utf8' }).status !== 0) {
      throw new Error('Private density reference compilation failed')
    }
    const run = spawnSync(binary, [], { input: payload, encoding: 'utf8' })
    if (run.status !== 0) throw new Error('Private density reference execution failed')
    const lines = run.stdout.trim().split('\n')
    expect(lines.length).toBe(cases.length)
    cases.forEach(({ profile, depth }, index) => {
      const calls: number[] = []
      const sample = createElementDensitySampler([profile], x => { calls.push(x); return x / (1 + Math.abs(x)) })
      const actual = [sample(profile, depth), ...calls]
      const expected = lines[index].split(' ').map(Number)
      expect(actual.length).toBe(expected.length)
      actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(1e-15 + 1e-10 * Math.abs(expected[i])))
    })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
