import { expect, it } from 'vitest'
import { initialState, reducer } from '../state/appState'
import type { DatabaseValues } from './databaseValues'

const result: DatabaseValues = { mode: 'compound', updates: [{ index: 1, first: 1, second: 2, firstMag: 3, secondMag: 4 }], warnings: ['test warning'] }
it('applies scalar updates as one undo step and retains the report independently', () => {
  const source = initialState()
  let state = reducer(source, { type: 'beginDatabaseUpdate', id: 1 })
  state = reducer(state, { type: 'completeDatabaseUpdate', id: 1, source: source.project, tables: source.opticalTables, epoch: source.fitEpoch, result })
  expect(state.project.sample.layers[1]).toEqual({ ...source.project.sample.layers[1], delta: 1, beta: 2, deltaMag: 3, betaMag: 4 })
  expect(state.project.sample.layers[2]).toBe(source.project.sample.layers[2])
  expect(state.history.past).toHaveLength(1)
  expect(state.databaseUpdate.result).toEqual(result)
  state = reducer(state, { type: 'dismissDatabaseUpdate' })
  expect(state.databaseUpdate.result).toBeNull()
  expect(reducer(state, { type: 'undo' }).project).toBe(source.project)
})

it('discards stale project, table-library and undo/load results without changing the current project', () => {
  const source = initialState()
  const started = reducer(source, { type: 'beginDatabaseUpdate', id: 1 })
  const edited = reducer(started, { type: 'updateLayer', index: 1, patch: { thickness: 45 } })
  const library = reducer(started, { type: 'clearOpticalTables' })
  const undone = reducer(edited, { type: 'undo' })
  const loaded = reducer(started, { type: 'loadProject', project: source.project, fileName: 'same.json' })
  for (const current of [edited, library, undone, loaded]) {
    const state = reducer(current, { type: 'completeDatabaseUpdate', id: 1, source: source.project, tables: source.opticalTables, epoch: source.fitEpoch, result })
    expect(state.project).toBe(current.project)
    expect(state.databaseUpdate.error).toContain('discarded')
    expect(state.history).toBe(current.history)
  }
  const newer = reducer(started, { type: 'beginDatabaseUpdate', id: 2 })
  expect(reducer(newer, { type: 'failDatabaseUpdate', id: 1, error: 'old' })).toBe(newer)
  expect(reducer(newer, { type: 'completeDatabaseUpdate', id: 1, source: source.project, tables: source.opticalTables, epoch: 0, result })).toBe(newer)
})

it('applies active and inactive stored tensors in one undo step and keeps response buffers isolated', () => {
  const source = initialState()
  source.project = { ...source.project, sample: { ...source.project.sample,
    elementProfiles: [{ element: 'Fe', f1: 1, f2: 2, f1Mag: 0, f2Mag: 0, slabs: [] }] } }
  const tensorResult: DatabaseValues = { mode: 'compound', engine: 'real', warnings: [],
    updates: [{ ...result.updates[0], dielectricTensor: { values: Array(18).fill(3), anisotropic: true } }],
    inactiveTensorUpdates: [{ index: 0, scatteringTensor: Array(18).fill(4) }] }
  const started = reducer(source, { type: 'beginDatabaseUpdate', id: 7 })
  const state = reducer(started, { type: 'completeDatabaseUpdate', id: 7, source: source.project,
    tables: source.opticalTables, epoch: source.fitEpoch, result: tensorResult })
  expect(state.history.past).toHaveLength(1)
  expect(state.project.sample.layers[1].dielectricTensor).toEqual({ values: Array(18).fill(3), anisotropic: true })
  expect(state.project.sample.elementProfiles[0].scatteringTensor).toEqual(Array(18).fill(4))
  tensorResult.updates[0].dielectricTensor!.values[0] = 99
  tensorResult.inactiveTensorUpdates![0].scatteringTensor![0] = 99
  expect(state.project.sample.layers[1].dielectricTensor!.values[0]).toBe(3)
  expect(state.project.sample.elementProfiles[0].scatteringTensor![0]).toBe(4)
  expect(reducer(state, { type: 'undo' }).project).toBe(source.project)
  const onlyInactive = reducer(started, { type: 'completeDatabaseUpdate', id: 7, source: source.project,
    tables: source.opticalTables, epoch: source.fitEpoch, result: { ...tensorResult, updates: [] } })
  expect(onlyInactive.project.sample.layers).toEqual(source.project.sample.layers)
  expect(onlyInactive.project.sample.elementProfiles[0].scatteringTensor![0]).toBe(99)
  expect(onlyInactive.history.past).toHaveLength(1)
})
