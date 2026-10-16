import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import type { OpticalTable } from '../import/tables'
import { refreshCompoundConstants, type RealTableLookup } from './refreshOpticalConstants'

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

it('rejects missing, empty, differently named and out-of-range primary tables, tensor data and invalid results', () => {
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
