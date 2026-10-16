import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import type { OpticalTable } from '../import/tables'
import type { RealTableLookup } from './refreshOpticalConstants'
import { realLayerSpectrum, realScatteringFactors } from './realSpectrum'

const table = (name: string, kind: OpticalTable['kind'], energy = [100, 150, 200]): OpticalTable => ({
  name, kind, energy, columns: [energy.map((_, index) => index + 1), energy.map((_, index) => index + 4)], warnings: [],
})
it('refreshes a compound magnetic spectrum in order and retains values when primary ranges exclude points', () => {
  const project = createDefaultProject()
  project.sample.layers = [createLayer({ opticalTable: 'sample', deltaMag: 9, betaMag: 8 })]
  const before = structuredClone(project)
  const tables = [table('sample', 'db', [120, 180]), table('sample', 'm')]
  const lookup = vi.fn<RealTableLookup>(source => ({ values: new Float64Array(source.kind === 'm' ? [3, 4] : [1, 2]), cursor: 1 }))
  const spectrum = realLayerSpectrum(project, { layerIndex: 0, magnetic: true, tables }, lookup)
  expect(spectrum).toEqual({ energy: [100, 150, 200], first: [9, 3, 3], second: [8, 4, 4] })
  expect(lookup.mock.calls.map(([source]) => source.kind)).toEqual(['db', 'm'])
  expect(project).toEqual(before)
})
it('uses native cursor state across spectrum points and omits zero only for scattering factors', () => {
  const project = createDefaultProject(); project.sample.mode = 'element'
  project.sample.elementProfiles = [{ element: 'Fe', f1: 0, f2: 0, f1Mag: 0, f2Mag: 0, slabs: [{ thickness: 1, roughness: 0, density: 2 }] }]
  const tables = [table('Fe', 'ff', [0, 100, 150, 200])]
  const lookup = vi.fn<RealTableLookup>((_table, _energy, cursor) => ({ values: new Float64Array([cursor + 1, 2]), cursor: cursor + 1 }))
  expect(realScatteringFactors(project, { elementIndex: 0, tables }, lookup)).toEqual({ energy: [100, 150, 200], first: [1, 2, 3], second: [2, 2, 2] })
  expect(lookup.mock.calls.map(([, , cursor]) => cursor)).toEqual([0, 1, 2])
  expect(() => realLayerSpectrum(project, { layerIndex: 0, magnetic: false, tables }, lookup)).toThrow('positive finite')
})
it('sums element densities with legacy expression order, retaining out-of-range element factors', () => {
  const project = createDefaultProject(); project.sample.mode = 'element'
  project.sample.elementProfiles = ['Fe', 'Co'].map(element => ({ element, f1: 10, f2: 5, f1Mag: 0, f2Mag: 0,
    slabs: [{ density: element === 'Fe' ? 2 : 3, thickness: 1, roughness: 0 }] }))
  const before = structuredClone(project)
  const tables = [table('Fe', 'ff'), table('Co', 'ff', [120, 180])]
  const lookup: RealTableLookup = source => ({ values: new Float64Array(source.name === 'Fe' ? [1, 2] : [20, 30]), cursor: 0 })
  const result = realLayerSpectrum(project, { layerIndex: 0, magnetic: false, tables }, lookup)
  const term = (factor: number, density: number, energy: number) => factor * density / energy / energy * .0004151761541 * 1e6
  expect(result.first).toEqual([term(1, 2, 100) + term(10, 3, 100), term(1, 2, 150) + term(20, 3, 150), term(1, 2, 200) + term(20, 3, 200)])
  expect(result.second).toEqual([term(2, 2, 100) + term(5, 3, 100), term(2, 2, 150) + term(30, 3, 150), term(2, 2, 200) + term(30, 3, 200)])
  expect(project).toEqual(before)
})
it('rejects unsupported scripts, missing selections/tables and nonfinite results', () => {
  const project = createDefaultProject(); project.sample.layers = [createLayer({ opticalTable: 'sample' })]
  const query = { layerIndex: 0, magnetic: false, tables: [table('sample', 'db')] }
  const lookup = vi.fn<RealTableLookup>(() => ({ values: new Float64Array([1, 2]), cursor: 0 }))
  project.scripts.enabled = true; project.scripts.beforeCalculation = 'change_state()'
  expect(() => realLayerSpectrum(project, query, lookup)).toThrow('Lua')
  expect(lookup).not.toHaveBeenCalled()
  project.scripts.enabled = false
  expect(() => realLayerSpectrum(project, { ...query, layerIndex: 2 }, lookup)).toThrow('Select')
  expect(() => realLayerSpectrum(project, { ...query, tables: [] }, lookup)).toThrow('Load')
  expect(() => realScatteringFactors(project, { elementIndex: 0, tables: [] }, lookup)).toThrow('Select')
  expect(() => realLayerSpectrum(project, query, () => ({ values: new Float64Array([Infinity, 2]), cursor: 0 }))).toThrow('Invalid scalar')
})
