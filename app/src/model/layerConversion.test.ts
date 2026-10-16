import { expect, it } from 'vitest'
import { createDefaultProject, createDepthProfileFunction, createLayer } from './defaults'
import { applyLayerConversion } from './layerConversion'
import { initialState, reducer } from '../state/appState'

it('preserves outer targets and profile couplings, reports removed references, and retains unrelated data', () => {
  const project = createDefaultProject()
  const count = project.sample.layers.length
  project.fit.parameters = [0, 1, count - 1].map(index => ({ target: 'delta', index, elementIndex: null, value: 0.1, step: 0.01, lowerBound: 0, upperBound: 1 }))
  project.sample.depthProfileFunctions = [null, 0, count - 1, 1, count, count + 10].map(boundToLayer => ({ ...createDepthProfileFunction(), boundToLayer, amplitudeCoupledTo: 0 }))
  const before = structuredClone(project)
  const layers = Array.from({ length: 30 }, () => createLayer())
  const result = applyLayerConversion(project, layers)
  expect(result.project.fit.parameters.map(parameter => parameter.index)).toEqual([0, 29])
  expect(result.project.sample.depthProfileFunctions.map(profile => profile.boundToLayer)).toEqual([null, 0, 29, 30, 30, 30])
  expect(result.project.sample.depthProfileFunctions.every(profile => profile.amplitudeCoupledTo === 0)).toBe(true)
  expect(result.project.scripts).toBe(project.scripts)
  expect(result.project.datasets).toBe(project.datasets)
  expect(result.notes.join(' ')).toContain('1 fit parameter(s)')
  expect(project).toEqual(before)
})

it('applies atomically with undo/redo and invalidates sessions even for equal-sized replacements', () => {
  const state = initialState()
  const layers = state.project.sample.layers.map(layer => ({ ...layer, material: 'unknown' }))
  const action = { type: 'applyLayerConversion' as const, source: state.project, epoch: state.fitEpoch, tables: state.opticalTables, layers }
  const next = reducer(state, action)
  expect(next.fitEpoch).toBeGreaterThan(state.fitEpoch)
  expect(next.history.past).toHaveLength(1)
  expect(reducer(next, { type: 'undo' }).project).toBe(state.project)
  expect(reducer(reducer(next, { type: 'undo' }), { type: 'redo' }).project).toBe(next.project)
  expect(reducer(next, action).project).toBe(next.project)
  expect(reducer({ ...state, fitEpoch: state.fitEpoch + 1 }, action).project).toBe(state.project)
  expect(reducer({ ...state, opticalTables: [] }, action).project).toBe(state.project)
  expect(() => applyLayerConversion(state.project, [])).toThrow('invalid layer list')
})
