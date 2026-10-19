import { expect, it } from 'vitest'
import { initialState, reducer } from './appState'
import { applyScriptExecution, type ScriptExecutionResult } from '../model/manualScript'
import { projectSchema } from '../model/project'
function fixture() {
  const state = initialState(), project = structuredClone(state.project)
  project.sample.layers[1].thickness = 42
  project.sample.elementProfiles = [{ element: 'Fe', f1: 1, f2: 2, f1Mag: 0, f2Mag: 0, slabs: [] }]
  const result: ScriptExecutionResult = { project, scriptMessages: ['done'], opticalState: {
    layers: project.sample.layers, cursors: new Map(), dielectricTensors: project.sample.layers.map(() => null),
    dielectricState: project.sample.layers.map(() => ({ values: new Float64Array(18).fill(7), anisotropic: true })),
    scatteringTensors: [new Float64Array(18).fill(8)],
  } }
  const action = { type: 'applyScriptExecution' as const, source: state.project, tables: state.opticalTables, epoch: state.fitEpoch, result }
  return { state, result, action }
}
it('applies scalars and complete tensor state as one undo step with JSON round-trip and no worker aliases', () => {
  const { state, result, action } = fixture()
  const applied = reducer(state, action)
  expect(applied.history.past).toEqual([state.project])
  expect(applied.project.sample.layers[1].thickness).toBe(42)
  expect(applied.project.sample.layers[1].dielectricTensor).toEqual({ values: Array(18).fill(7), anisotropic: true })
  expect(applied.project.sample.elementProfiles[0].scatteringTensor).toEqual(Array(18).fill(8))
  expect(projectSchema.parse(JSON.parse(JSON.stringify(applied.project)))).toEqual(applied.project)
  expect(applied.fitEpoch).toBeGreaterThan(state.fitEpoch)
  expect(reducer(applied, { type: 'undo' }).project).toBe(state.project)
  expect(reducer(reducer(applied, { type: 'undo' }), { type: 'redo' }).project).toBe(applied.project)
  result.opticalState.dielectricState![1]!.values.fill(99)
  result.opticalState.scatteringTensors![0].fill(99)
  result.project.sample.layers[1].thickness = 99
  expect(applied.project.sample.layers[1].thickness).toBe(42)
  expect(applied.project.sample.layers[1].dielectricTensor!.values[0]).toBe(7)
  expect(applied.project.sample.elementProfiles[0].scatteringTensor![0]).toBe(8)
  expect(projectSchema.parse(state.project)).toEqual(state.project)
})
it.each(['project', 'tables', 'epoch'] as const)('rejects a result after %s changes without an undo entry', field => {
  const { state, action } = fixture()
  const changed = field === 'project' ? { ...state, project: structuredClone(state.project) }
    : field === 'tables' ? { ...state, opticalTables: [] } : { ...state, fitEpoch: state.fitEpoch + 1 }
  const next = reducer(changed, action)
  expect(next.project).toBe(changed.project)
  expect(next.history).toBe(changed.history)
  expect(next.notice).toContain('discarded')
})
it.each(['count', 'missing', 'nonfinite', 'invalid-project'] as const)('rejects %s worker state atomically', problem => {
  const { state, result, action } = fixture()
  if (problem === 'count') result.opticalState.scatteringTensors = []
  if (problem === 'missing') result.opticalState.dielectricState![0] = null
  if (problem === 'nonfinite') result.opticalState.dielectricState![0]!.values[0] = NaN
  if (problem === 'invalid-project') result.project.sample.layers[1].thickness = -1
  expect(() => applyScriptExecution(result)).toThrow()
  const next = reducer(state, action)
  expect(next.project).toBe(state.project)
  expect(next.history).toBe(state.history)
  expect(next.notice).toContain('invalid')
})
it('rejects invalid tensor JSON instead of discarding the new optional fields', () => {
  const { result } = fixture(), saved = applyScriptExecution(result)
  saved.sample.layers[0].dielectricTensor!.values.pop()
  expect(projectSchema.safeParse(saved).success).toBe(false)
})
