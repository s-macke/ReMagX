import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { realTensor } from './realTensor'
import type { OpticalTable } from '../import/tables'
import type { DielectricTensorCalculator } from './visnovskyRequest'
import type { RealTableLookup } from './refreshOpticalConstants'

const table = (kind: OpticalTable['kind'], energy = [100, 150, 200]): OpticalTable => ({ name: 'sample', kind, energy,
  columns: Array.from({ length: kind === 'e' ? 18 : 2 }, () => energy.map(() => 1)), warnings: [] })
function fixture() {
  const project = createDefaultProject()
  project.experiment.energy = 150
  project.sample.layers = [createLayer({ opticalTable: 'sample', delta: .01, magnetization: { gamma: 30, phi: 60 } })]
  const construct = vi.fn<DielectricTensorCalculator>(() => ({ values: new Float64Array(18).fill(7), anisotropic: true }))
  const lookup = vi.fn<RealTableLookup>((source, _queries, cursor) => ({ values: new Float64Array(source.kind === 'e' ? 18 : 2).fill(3), cursor: cursor + 1 }))
  return { project, construct, lookup }
}
it('builds scalar snapshots natively and applies imported tensors only when automatic refresh is enabled', () => {
  const { project, construct, lookup } = fixture()
  project.calculation.tensorContribution = 'tetragonal'; project.calculation.magnetization.mode = 'add'
  const query = { layerIndex: 0, spectrum: false, tables: [table('db'), table('e')] }
  expect(realTensor(project, query, lookup, construct).source).toBe('scalar')
  expect(construct).toHaveBeenCalledWith(expect.objectContaining({ tensor: 1, magnetic: 1, layer: [0, 0, .01, 0, 0, 0, 30, 60] }))
  expect(lookup).not.toHaveBeenCalled()
  construct.mockClear(); project.calculation.automaticOpticalConstants = true
  expect(realTensor(project, query, lookup, construct).tensors[0][0]).toEqual({ re: 3, im: 3 })
  expect(construct).not.toHaveBeenCalled()
})
it('uses the tensor grid and retains the previous tensor across primary range failures', () => {
  const { project, construct, lookup } = fixture()
  const before = structuredClone(project)
  const result = realTensor(project, { layerIndex: 0, spectrum: true, tables: [table('db', [120, 180]), table('e')] }, lookup, construct)
  expect(result.energy).toEqual([100, 150, 200])
  expect(result.tensors.map(tensor => tensor[0].re)).toEqual([7, 3, 3])
  expect(result.source).toBe('table')
  expect(construct).toHaveBeenCalledTimes(1)
  expect(lookup.mock.calls.map(([table]) => table.kind)).toEqual(['db', 'e'])
  expect(project).toEqual(before)
})
it('refreshes unselected layers in original order, skips missing tables and retains table cursors', () => {
  const { project, construct, lookup } = fixture()
  project.sample.layers.push(createLayer({ opticalTable: 'missing' }), createLayer({ opticalTable: 'sample' }))
  const result = realTensor(project, { layerIndex: 2, spectrum: true, tables: [table('db'), table('e')] }, lookup, construct)
  expect(result.tensors).toHaveLength(3)
  expect(lookup.mock.calls.map(([, , cursor]) => cursor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  expect(construct).not.toHaveBeenCalled()
  result.tensors[0][0].re = 999
  expect(result.tensors[1][0].re).toBe(3)
})
it('rejects unimplemented scripts and invalid selections/grids/native tensors', () => {
  const { project, construct, lookup } = fixture()
  const query = { layerIndex: 0, spectrum: true, tables: [table('db')] }
  project.scripts.enabled = true; project.scripts.beforeCalculation = 'change_state()'
  expect(() => realTensor(project, query, lookup, construct)).toThrow('Lua')
  project.scripts.enabled = false
  expect(() => realTensor(project, { ...query, tables: [] }, lookup, construct)).toThrow('Load')
  expect(() => realTensor(project, { ...query, layerIndex: 4 }, lookup, construct)).toThrow('Select')
  expect(() => realTensor(project, { ...query, tables: [table('db', [0])] }, lookup, construct)).toThrow('positive')
  construct.mockReturnValue({ values: new Float64Array([1]), anisotropic: false })
  expect(() => realTensor(project, query, lookup, construct)).toThrow('Invalid native')
})

it('retains saved tensors for skipped automatic refresh, replaces on valid tables and rebuilds in manual mode', () => {
  const { project, construct, lookup } = fixture()
  project.sample.layers[0].dielectricTensor = { values: Array(18).fill(9), anisotropic: true }
  project.calculation.automaticOpticalConstants = true
  const before = structuredClone(project)
  const snapshot = { layerIndex: 0, spectrum: false, tables: [] }
  const retained = realTensor(project, snapshot, lookup, construct)
  expect(retained.source).toBe('stored')
  expect(retained.tensors[0]).toEqual(Array(9).fill({ re: 9, im: 9 }))
  expect(construct).not.toHaveBeenCalled()
  project.experiment.energy = 90
  const spectrum = { layerIndex: 0, spectrum: true, tables: [table('db', [120, 180]), table('e')] }
  const result = realTensor(project, spectrum, lookup, construct)
  expect(result.tensors.map(tensor => tensor[0].re)).toEqual([9, 3, 3])
  expect(result.source).toBe('table')
  project.calculation.automaticOpticalConstants = false
  expect(realTensor(project, snapshot, lookup, construct).tensors[0][0].re).toBe(7)
  project.calculation.automaticOpticalConstants = true; project.experiment.energy = 150
  expect(project).toEqual(before)
})
