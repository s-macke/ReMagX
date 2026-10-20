import { expect, it } from 'vitest'
import { parseOpticalTable } from '../import/tables'
import { mergeOpticalTables, readStoredOpticalTable } from './materialLibrary'
import { initialState, reducer } from '../state/appState'

const original = parseOpticalTable('700 1 2\n800 3 4', 'Co.db')
const replacement = parseOpticalTable('700 5 6\n800 7 8', 'Co.db')
const magnetic = parseOpticalTable('700 -1 0\n800 1 0', 'Co.m')

it('replaces one material/kind, retaining other kinds, names and import warnings', () => {
  const other = parseOpticalTable('bad\n700 1 2', 'Ni.db')
  expect(mergeOpticalTables([original, magnetic, other], [replacement])).toEqual([replacement, magnetic, other])
  expect(readStoredOpticalTable({ version: 1, table: other })).toEqual(other)
  expect(original.columns[0]).toEqual([1, 3])
})

it('rejects unreadable and newer-version records without accepting mismatched columns', () => {
  expect(readStoredOpticalTable({ version: 2, table: original })).toBeNull()
  expect(readStoredOpticalTable(null)).toBeNull()
  expect(readStoredOpticalTable({ version: 1, table: { ...original, columns: [[1], [2]] } })).toBeNull()
  expect(readStoredOpticalTable({ version: 1, table: { ...original, energy: [800, 700] } })).toBeNull()
  expect(readStoredOpticalTable({ version: 1, table: { ...original, columns: [[1, Infinity], [2, 3]] } })).toBeNull()
})

it('imports during restoration win, while clearing during restoration prevents resurrection', () => {
  let state = reducer(initialState(), { type: 'addOpticalTables', tables: [replacement] })
  const restored = reducer(state, { type: 'restoreOpticalTables', tables: [original, magnetic], error: null })
  expect(restored.opticalTables).toEqual([replacement, magnetic])
  expect(restored.materialLibrary.ready).toBe(true)
  expect(restored.materialLibrary.revision).toBe(1)
  state = reducer(state, { type: 'clearOpticalTables' })
  state = reducer(state, { type: 'addOpticalTables', tables: [magnetic] })
  state = reducer(state, { type: 'restoreOpticalTables', tables: [original], error: null })
  expect(state.opticalTables).toEqual([magnetic])
  expect(state.materialLibrary.resetVersion).toBe(1)
  expect(state.history.past).toHaveLength(0)
})

it('reports the latest save failure without stale completions hiding it', () => {
  let state = reducer(initialState(), { type: 'addOpticalTables', tables: [original] })
  state = reducer(state, { type: 'addOpticalTables', tables: [replacement] })
  state = reducer(state, { type: 'materialLibraryFailed', revision: 2, error: 'quota' })
  state = reducer(state, { type: 'materialLibrarySaved', revision: 1 })
  expect(state.materialLibrary.error).toBe('quota')
  state = reducer(state, { type: 'materialLibrarySaved', revision: 2 })
  expect(state.materialLibrary.error).toBeNull()
  expect(reducer(state, { type: 'materialLibraryFailed', revision: 1, error: 'old' })).toBe(state)
})

it('imports and restores full scattering tensors independently of dielectric and scalar tables', () => {
  const row = [700, ...Array.from({ length: 18 }, (_, index) => index + 1)].join(' ')
  const scattering = parseOpticalTable(row, 'Co.F')
  const dielectric = parseOpticalTable(row, 'Co.e')
  expect(scattering.kind).toBe('f')
  expect(scattering.columns).toEqual(Array.from({ length: 18 }, (_, index) => [index + 1]))
  expect(scattering.warnings).toEqual([])
  expect(readStoredOpticalTable({ version: 1, table: scattering })).toEqual(scattering)
  expect(mergeOpticalTables([original, dielectric], [scattering])).toEqual([original, dielectric, scattering])
  expect(readStoredOpticalTable({ version: 1, table: { ...scattering, columns: [[1], [2]] } })).toBeNull()
})
