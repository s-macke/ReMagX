import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { resolveChantlerTables } from './chantlerTables'
import type { OpticalTable } from '../import/tables'

function fixture(names = ['Fe']) {
  const project = createDefaultProject()
  project.sample.mode = 'element'; project.calculation.useChantlerDatabase = true
  project.sample.elementProfiles = names.map(element => ({ element, f1: 0, f2: 0, f1Mag: 0, f2Mag: 0, slabs: [] }))
  return project
}

it('respects the saved flag and active film without changing supplied tables', () => {
  const project = fixture(), tables: OpticalTable[] = []
  project.calculation.useChantlerDatabase = false
  expect(resolveChantlerTables(project, tables)).toBe(tables)
  project.calculation.useChantlerDatabase = true; project.sample.mode = 'compound'
  expect(resolveChantlerTables(project, tables)).toBe(tables)
  project.sample.mode = 'element'
  const snapshot = structuredClone(project)
  const result = resolveChantlerTables(project, tables)
  expect(result[0].name).toBe('Fe'); expect(result[0].energy.length).toBeGreaterThan(100)
  expect(tables).toEqual([]); expect(project).toEqual(snapshot)
  result[0].energy[0] = -1; result[0].columns[0][0] = 999
  expect(resolveChantlerTables(project, tables)[0].energy[0]).toBeGreaterThan(0)
  expect(resolveChantlerTables(project, tables)[0].columns[0][0]).not.toBe(999)
})

it('preserves imported primary and auxiliary tables, replaces empty primary and shares duplicate-name cursors', () => {
  const project = fixture(['Fe', 'Fe', 'Co'])
  project.experiment.energy = 700
  const local: OpticalTable = { name: 'Fe', kind: 'ff', energy: [1, 2], columns: [[8, 9], [1, 2]], warnings: [] }
  const magnetic: OpticalTable = { ...local, name: 'Co', kind: 'ffm' }
  const tensor: OpticalTable = { ...local, name: 'Co', kind: 'f' }
  const empty: OpticalTable = { name: 'Co', kind: 'ff', energy: [], columns: [[], []], warnings: [] }
  const supplied = [local, magnetic, empty, tensor], snapshot = structuredClone(supplied)
  const result = resolveChantlerTables(project, supplied)
  expect(result).toHaveLength(4)
  expect(result[0]).toBe(local); expect(result[1]).toBe(magnetic); expect(result[3]).toBe(tensor)
  expect(result[2].energy.length).toBeGreaterThan(100)
  expect(supplied).toEqual(snapshot)
  expect(resolveChantlerTables(fixture(['Fe', 'Fe']), [])).toHaveLength(1)
})

it('preserves exact legacy symbol lookup and the approved Uranium endpoint', () => {
  const result = resolveChantlerTables(fixture(['Ti', 'Tl', 'fe', ' Fe', 'Unknown', 'Np', 'U']), [])
  expect(result.map(table => table.name)).toEqual(['Ti', 'U'])
  expect(result[1].energy).toHaveLength(277)
  expect(result[1].energy.at(-1)).toBe(432945.09375)
  expect(result[1].energy.every((value, index, values) => !index || value >= values[index - 1])).toBe(true)
})
