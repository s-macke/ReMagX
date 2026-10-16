import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { realDatabaseValues } from './realDatabaseValues'
import { applyDatabaseValues } from './databaseValues'
import type { OpticalTable } from '../import/tables'
import type { RealTableLookup } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'

const table = (kind: OpticalTable['kind'], name = 'sample', energy = [100, 200]): OpticalTable => ({
  name, kind, energy, columns: [[1, 1], [2, 2]], warnings: [],
})
it('uses exact names, wavelength-round-trip energy, shared native cursors and partial-update reporting', () => {
  const project = createDefaultProject(); project.experiment.energy = 150
  project.sample.layers = ['sample', 'sample', 'Sample', 'sample.db', 'path/sample', 'outside'].map(opticalTable => createLayer({ opticalTable }))
  const before = structuredClone(project)
  const tables = [table('db'), table('m', 'sample', [300, 400]), table('db', 'outside', [300, 400]), table('e')]
  const lookup = vi.fn<RealTableLookup>((source, queries, cursor) => {
    expect(queries).toEqual([HC_EV_ANGSTROM / (HC_EV_ANGSTROM / 150)])
    return { values: new Float64Array(source.kind === 'm' ? [0, 0] : [1, 2]), cursor: cursor + 1 }
  })
  const result = realDatabaseValues(project, tables, lookup)
  expect(result.updates).toEqual([0, 1].map(index => ({ index, first: 1, second: 2, firstMag: 0, secondMag: 0 })))
  expect(lookup.mock.calls.map(([source, , cursor]) => [source.kind, cursor])).toEqual([['db', 0], ['m', 0], ['db', 1], ['m', 1]])
  expect(result.warnings.filter(warning => warning.includes('values kept'))).toHaveLength(4)
  expect(result.warnings.some(warning => warning.includes('tensor data remains'))).toBe(true)
  expect(result.warnings.some(warning => warning.includes('magnetic values set to zero'))).toBe(true)
  const updated = applyDatabaseValues(project, result)
  expect(updated.sample.layers[0]).toMatchObject({ delta: 1, beta: 2, deltaMag: 0, betaMag: 0 })
  expect(updated.sample.layers[2]).toBe(project.sample.layers[2])
  expect(project).toEqual(before)
})
it('supports imported element form factors and reports missing built-in data', () => {
  const project = createDefaultProject(); project.sample.mode = 'element'; project.experiment.energy = 150
  project.sample.elementProfiles = ['Fe', 'Co'].map(element => ({ element, f1: 7, f2: 8, f1Mag: 9, f2Mag: 10, slabs: [] }))
  const result = realDatabaseValues(project, [table('ff', 'Fe'), { ...table('ffm', 'Fe'), energy: [] }],
    () => ({ values: new Float64Array([26, .5]), cursor: 0 }))
  expect(result.updates).toEqual([{ index: 0, first: 26, second: .5, firstMag: 0, secondMag: 0 }])
  expect(result.warnings.some(warning => warning.includes('Built-in element tables'))).toBe(true)
  const updated = applyDatabaseValues(project, result)
  expect(updated.sample.elementProfiles[0]).toMatchObject({ f1: 26, f2: .5, f1Mag: 0, f2Mag: 0 })
  expect(project.sample.elementProfiles[0].f1).toBe(7)
})
it('rejects invalid energy and malformed native results without mutating the project', () => {
  const project = createDefaultProject(); project.sample.layers = [createLayer({ opticalTable: 'sample' })]
  project.experiment.energy = 150
  for (const values of [new Float64Array([NaN, 1]), new Float64Array([1])]) {
    expect(() => realDatabaseValues(project, [table('db')], () => ({ values, cursor: 0 }))).toThrow('Invalid scalar')
  }
  project.experiment.energy = 0
  expect(() => realDatabaseValues(project, [], vi.fn())).toThrow('positive photon energy')
})
