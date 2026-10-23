import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { realDatabaseValues } from './realDatabaseValues'
import { applyDatabaseValues } from './databaseValues'
import type { OpticalTable } from '../import/tables'
import type { RealTableLookup } from './refreshOpticalConstants'
import type { DielectricTensorCalculator } from './visnovskyRequest'
import type { ScatteringTensorCalculator } from './scatteringTensors'
import { HC_EV_ANGSTROM } from './units'

const table = (kind: OpticalTable['kind'], name = 'sample', energy = [100, 200]): OpticalTable => ({
  name, kind, energy, columns: Array.from({ length: kind === 'e' ? 18 : 2 }, (_, index) => [index + 1, index + 1]), warnings: [],
})
function engine(lookup: RealTableLookup) {
  return { lookup,
    dielectricTensor: vi.fn<DielectricTensorCalculator>(({ layer }) => ({ values: new Float64Array(18).fill(layer[2] + 10), anisotropic: false })),
    scatteringTensor: vi.fn<ScatteringTensorCalculator>(({ factors }) => new Float64Array(18).fill(factors[0] + 100)),
  }
}
it('performs automatic preparation and explicit refresh with shared cursors, imported tensors and exact names', () => {
  const project = createDefaultProject(); project.experiment.energy = 150
  project.calculation.automaticOpticalConstants = true
  project.sample.layers = ['sample', 'sample', 'Sample', 'sample.db', 'path/sample', 'outside'].map(opticalTable => createLayer({ opticalTable,
    dielectricTensor: { values: Array(18).fill(9), anisotropic: true } }))
  const before = structuredClone(project)
  const tables = [table('db'), table('m', 'sample', [300, 400]), table('db', 'outside', [300, 400]), table('e')]
  const lookup = vi.fn<RealTableLookup>((source, queries, cursor) => {
    expect(queries).toEqual([HC_EV_ANGSTROM / (HC_EV_ANGSTROM / 150)])
    return { values: new Float64Array(source.kind === 'e' ? Array(18).fill(3) : source.kind === 'm' ? [0, 0] : [1, 2]), cursor: cursor + 1 }
  })
  const native = engine(lookup)
  const result = realDatabaseValues(project, tables, native)
  expect(result.engine).toBe('real')
  expect(result.updates).toEqual([0, 1].map(index => ({ index, first: 1, second: 2, firstMag: 0, secondMag: 0,
    dielectricTensor: { values: Array(18).fill(3), anisotropic: true } })))
  expect(lookup.mock.calls.map(([source, , cursor]) => [source.kind, cursor])).toEqual(
    [0, 1, 2, 3].flatMap(cursor => ['db', 'm', 'e'].map(kind => [kind, cursor])))
  expect(native.dielectricTensor).not.toHaveBeenCalled()
  expect(result.warnings.filter(warning => warning.includes('values kept'))).toHaveLength(4)
  expect(result.warnings.some(warning => warning.includes('magnetic values set to zero'))).toBe(true)
  const updated = applyDatabaseValues(project, result)
  expect(updated.sample.layers[0]).toMatchObject({ delta: 1, beta: 2, deltaMag: 0, betaMag: 0,
    dielectricTensor: { values: Array(18).fill(3), anisotropic: true } })
  expect(updated.sample.layers[2]).toBe(project.sample.layers[2])
  result.updates[0].dielectricTensor!.values[0] = 99
  expect(updated.sample.layers[0].dielectricTensor!.values[0]).toBe(3)
  expect(project).toEqual(before)
})
it('rebuilds skipped manual tensors and preserves out-of-range imported tensor zeros', () => {
  const project = createDefaultProject(); project.experiment.energy = 150
  project.sample.layers = ['sample', 'missing'].map(opticalTable => createLayer({ opticalTable, delta: .3,
    dielectricTensor: { values: Array(18).fill(9), anisotropic: true } }))
  const native = engine(source => ({ values: new Float64Array(source.kind === 'e' ? Array(18).fill(0) : [1, 2]), cursor: 0 }))
  const before = structuredClone(project)
  const result = realDatabaseValues(project, [table('db'), table('e', 'sample', [300, 400])], native)
  expect(result.updates).toHaveLength(2)
  expect(result.updates[0].dielectricTensor).toEqual({ values: Array(18).fill(0), anisotropic: true })
  expect(result.updates[1]).toMatchObject({ first: .3, dielectricTensor: { values: Array(18).fill(10.3), anisotropic: false } })
  expect(result.warnings.some(value => value.includes('stored tensor rebuilt'))).toBe(true)
  expect(project).toEqual(before)
})
it('constructs refreshed scalar tensors using the layer direction and tensor settings', () => {
  const project = createDefaultProject(); project.experiment.energy = 150; project.calculation.automaticOpticalConstants = true
  project.calculation.tensorContribution = 'tetragonal'; project.calculation.magnetization.mode = 'profile'
  project.sample.layers = [createLayer({ opticalTable: 'sample', magnetization: { gamma: 12, phi: 34 } })]
  const native = engine(() => ({ values: new Float64Array([1, 2]), cursor: 0 }))
  const result = realDatabaseValues(project, [table('db')], native)
  expect(native.dielectricTensor).toHaveBeenCalledWith({ layer: [0, 0, 1, 2, 0, 0, 12, 34], tensor: 1, magnetic: 1 })
  expect(result.updates[0].dielectricTensor).toEqual({ values: Array(18).fill(11), anisotropic: false })
})
it('updates imported element factors and tensors while retaining skipped automatic entries', () => {
  const project = createDefaultProject(); project.sample.mode = 'element'; project.experiment.energy = 150
  project.calculation.automaticOpticalConstants = true
  project.sample.elementProfiles = ['Fe', 'Co'].map(element => ({ element, f1: 7, f2: 8, f1Mag: 9, f2Mag: 10,
    scatteringTensor: Array(18).fill(9), slabs: [] }))
  const native = engine(() => ({ values: new Float64Array([26, .5]), cursor: 0 }))
  const result = realDatabaseValues(project, [table('ff', 'Fe')], native)
  expect(result.updates).toEqual([{ index: 0, first: 26, second: .5, firstMag: 0, secondMag: 0, scatteringTensor: Array(18).fill(126) }])
  expect(result.warnings.some(warning => warning.includes('Co: no ff table; scalar values kept.'))).toBe(true)
  const updated = applyDatabaseValues(project, result)
  expect(updated.sample.elementProfiles[0]).toMatchObject({ f1: 26, f2: .5, f1Mag: 0, f2Mag: 0, scatteringTensor: Array(18).fill(126) })
  expect(updated.sample.elementProfiles[1]).toBe(project.sample.elementProfiles[1])
  result.updates[0].scatteringTensor![0] = 999
  expect(updated.sample.elementProfiles[0].scatteringTensor![0]).toBe(126)
  project.calculation.automaticOpticalConstants = false
  expect(realDatabaseValues(project, [], native).updates.map(update => update.scatteringTensor)).toEqual([Array(18).fill(107), Array(18).fill(107)])
})
it('rejects invalid energy, interpolation and tensor results without mutating the project', () => {
  const project = createDefaultProject(); project.sample.layers = [createLayer({ opticalTable: 'sample' })]
  project.experiment.energy = 150; project.calculation.automaticOpticalConstants = true
  const before = structuredClone(project)
  for (const values of [new Float64Array([NaN, 1]), new Float64Array([1])]) {
    expect(() => realDatabaseValues(project, [table('db')], engine(() => ({ values, cursor: 0 })))).toThrow('Invalid optical')
  }
  const native = engine(() => ({ values: new Float64Array([1, 2]), cursor: 0 }))
  native.dielectricTensor.mockReturnValue({ values: new Float64Array([1]), anisotropic: false })
  expect(() => realDatabaseValues(project, [table('db')], native)).toThrow('Invalid script dielectric tensor')
  expect(project).toEqual(before)
  project.experiment.energy = 0
  expect(() => realDatabaseValues(project, [], native)).toThrow('positive photon energy')
})
