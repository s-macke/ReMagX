import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import type { OpticalTable } from '../import/tables'
import { refreshCompoundConstants, refreshCompoundOptics, refreshCompoundOpticsState, type RealTableLookup } from './refreshOpticalConstants'

const table = (kind: OpticalTable['kind'] = 'db'): OpticalTable => ({
  name: 'sample', kind, energy: [100, 200], columns: [[1, 2], [3, 4]], warnings: [],
})
function projectWithTables() {
  const project = createDefaultProject()
  project.sample.layers.forEach(layer => { layer.opticalTable = 'sample'; layer.deltaMag = 9; layer.betaMag = 8 })
  return project
}

it('refreshes all layers with shared table cursors and independent magnetic cursors without changing the project', () => {
  const project = projectWithTables()
  const before = structuredClone(project)
  const tables = [table(), table('m')]
  const seen: [string, number][] = []
  const lookup: RealTableLookup = (source, queries, cursor) => {
    expect(queries).toEqual([150])
    seen.push([source.kind, cursor])
    return { values: new Float64Array([cursor + 1, cursor + 2]), cursor: cursor + 1 }
  }
  const layers = refreshCompoundConstants(project, tables, 150, lookup)
  expect(seen).toEqual(project.sample.layers.flatMap((_, i) => [['db', i], ['m', i]]))
  layers.forEach((layer, i) => {
    expect([layer.delta, layer.beta, layer.deltaMag, layer.betaMag]).toEqual([i + 1, i + 2, i + 1, i + 2])
    expect(layer.density).toBe(project.sample.layers[i].density)
  })
  expect(project).toEqual(before)
})

it('zeros missing or empty magnetics, and delegates out-of-range magnetic lookup to the native kernel', () => {
  const project = projectWithTables()
  const lookup = vi.fn<RealTableLookup>((source) => ({ values: new Float64Array(source.kind === 'db' ? [1, 2] : [0, 0]), cursor: 0 }))
  for (const magnetic of [[], [{ ...table('m'), energy: [], columns: [[], []] }], [{ ...table('m'), energy: [300, 400] }]]) {
    const result = refreshCompoundConstants(project, [table(), ...magnetic], 100, lookup)
    expect(result.every(layer => layer.deltaMag === 0 && layer.betaMag === 0)).toBe(true)
  }
  expect(lookup.mock.calls.some(([source]) => source.kind === 'm' && source.energy[0] === 300)).toBe(true)
})

it('rejects missing, empty, differently named and out-of-range primary tables, malformed tensor data and invalid results', () => {
  const project = projectWithTables()
  const before = structuredClone(project)
  const lookup: RealTableLookup = () => ({ values: new Float64Array([1, 2]), cursor: 0 })
  for (const tables of [[], [{ ...table(), name: 'Sample' }], [{ ...table(), energy: [] }], [table(), table('e')]]) {
    expect(() => refreshCompoundConstants(project, tables, 150, lookup)).toThrow()
  }
  for (const energy of [99, 201, NaN, 0]) expect(() => refreshCompoundConstants(project, [table()], energy, lookup)).toThrow()
  expect(() => refreshCompoundConstants(project, [table()], 200, lookup)).not.toThrow()
  expect(() => refreshCompoundConstants(project, [table()], 150, () => ({ values: new Float64Array([NaN, 0]), cursor: 0 }))).toThrow('Invalid optical')
  expect(project).toEqual(before)
  project.sample.mode = 'element'
  expect(() => refreshCompoundConstants(project, [table()], 150, lookup)).toThrow('element mode')
})

it('preserves Getdb lookup order and tensor entries without changing scalar constants', () => {
  const project = projectWithTables()
  const before = structuredClone(project)
  const tensor = { ...table('e'), columns: Array.from({ length: 18 }, (_, index) => [index, index + 1]) }
  const tables = [table(), table('m'), tensor]
  const values = new Float64Array(Array.from({ length: 18 }, (_, index) => index / 10))
  const seen: string[] = []
  const lookup: RealTableLookup = (source, _queries, cursor) => {
    seen.push(`${source.kind}:${cursor}`)
    return { values: source.kind === 'e' ? values : new Float64Array([.01, .002]), cursor: cursor + 1 }
  }
  const result = refreshCompoundOptics(project, tables, 150, lookup)
  expect(seen).toEqual(project.sample.layers.flatMap((_, index) => [`db:${index}`, `m:${index}`, `e:${index}`]))
  expect(result.layers[0]).toMatchObject({ delta: .01, beta: .002, deltaMag: .01, betaMag: .002 })
  expect(result.dielectricTensors[0]).toEqual(values)
  values[0] = 100
  expect(result.dielectricTensors[0]?.[0]).toBe(0)
  expect(project).toEqual(before)
  expect(refreshCompoundConstants(project, tables, 150, lookup)[0].delta).toBe(.01)
})

it('does not use tensor-table ranges as primary range checks and distinguishes empty from zero tensors', () => {
  const project = projectWithTables()
  const tensor = { ...table('e'), energy: [300, 400], columns: Array.from({ length: 18 }, () => [1, 1]) }
  const lookup = vi.fn<RealTableLookup>(source => ({ values: new Float64Array(source.kind === 'e' ? 18 : 2), cursor: 0 }))
  const result = refreshCompoundOptics(project, [table(), tensor], 150, lookup)
  expect(result.dielectricTensors.every(value => value !== null && value.every(component => component === 0))).toBe(true)
  const empty = refreshCompoundOptics(project, [table(), { ...tensor, energy: [] }], 150, lookup)
  expect(empty.dielectricTensors.every(value => value === null)).toBe(true)
  expect(() => refreshCompoundOptics(project, [tensor], 150, lookup)).toThrow('missing optical table')
})


it('retains partial scalar and tensor refreshes across skipped energies without changing prior state', () => {
  const project = projectWithTables()
  project.sample.layers = project.sample.layers.slice(0, 2)
  project.sample.layers[1].opticalTable = 'other'
  const before = structuredClone(project)
  const tables = [table(), { ...table(), name: 'other', energy: [150, 250] },
    { ...table('e'), columns: Array.from({ length: 18 }, () => [1, 2]) }]
  const oldTensors = [new Float64Array(18).fill(7), new Float64Array(18).fill(8)]
  const lookup = vi.fn<RealTableLookup>((source, [energy], cursor) => ({
    values: new Float64Array(source.kind === 'e' ? 18 : 2).fill(energy), cursor: cursor + 1,
  }))
  const cursors = new Map<OpticalTable, number>()
  const first = refreshCompoundOpticsState(project, tables, 125, lookup, cursors, oldTensors)
  expect(first.rangeError).toContain('other.db')
  expect(first.layers[0].delta).toBe(125)
  expect(first.layers[1]).toEqual(before.sample.layers[1])
  expect(first.dielectricTensors[0]).toEqual(new Float64Array(18).fill(125))
  expect(first.dielectricTensors[1]).toEqual(oldTensors[1])
  expect(first.dielectricTensors[1]).not.toBe(oldTensors[1])
  const next = { ...project, sample: { ...project.sample, layers: first.layers } }
  const second = refreshCompoundOpticsState(next, tables, 225, lookup, cursors, first.dielectricTensors)
  expect(second.rangeError).toContain('sample.db')
  expect(second.layers.map(layer => layer.delta)).toEqual([125, 225])
  expect(second.dielectricTensors[0]).toEqual(first.dielectricTensors[0])
  expect(second.dielectricTensors[0]).not.toBe(first.dielectricTensors[0])
  expect(second.dielectricTensors[1]).toBeNull() // successful scalar refresh replaces the old override
  expect(lookup.mock.calls.map(([source]) => source.name + '.' + source.kind)).toEqual(['sample.db', 'sample.e', 'other.db'])
  expect(project).toEqual(before)
  expect(oldTensors[0][0]).toBe(7)
  const complete = refreshCompoundOpticsState(next, tables, 175, lookup, cursors, second.dielectricTensors)
  expect(complete.rangeError).toBeNull()
  expect(complete.layers.map(layer => layer.delta)).toEqual([175, 175])
  expect(() => refreshCompoundOptics(project, tables, 125, lookup)).toThrow('other.db')
  expect(() => refreshCompoundOpticsState(project, tables, 175, lookup, cursors, [])).toThrow('layer count')
})
