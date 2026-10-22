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

it('replaces the stored compound stack in element mode while preserving element targets, selection and undo', () => {
  const state = initialState()
  state.project.sample.mode = 'element'
  state.project.sample.elementProfiles = [{ element: 'Fe', f1: 2, f2: 1, f1Mag: .1, f2Mag: .2,
    slabs: Array.from({ length: 5 }, () => ({ thickness: 5, density: .1, roughness: 2 })) }]
  state.selectedLayer = 3
  const parameter = { value: .1, step: .01, lowerBound: 0, upperBound: 1 }
  state.project.fit.parameters = [
    { ...parameter, target: 'elementDensity', elementIndex: 0, index: 3 },
    { ...parameter, target: 'elementF1', elementIndex: 0, index: null },
    { ...parameter, target: 'delta', elementIndex: null, index: 1 },
    { ...parameter, target: 'delta', elementIndex: null, index: state.project.sample.layers.length - 1 },
  ]
  state.project.sample.depthProfileFunctions = [{ ...createDepthProfileFunction(), boundToLayer: 1 }]
  const before = structuredClone(state.project)
  const layers = Array.from({ length: 3 }, () => createLayer({ opticalTable: 'unknown',
    dielectricTensor: { values: Array(18).fill(.5), anisotropic: true } }))
  const converted = applyLayerConversion(state.project, layers)
  expect(converted.notes.join(' ')).toContain('Element Mode are retained')
  const action = { type: 'applyLayerConversion' as const, source: state.project, epoch: state.fitEpoch, tables: state.opticalTables, layers }
  const next = reducer(state, action)
  expect(next.project.sample.mode).toBe('element')
  expect(next.project.sample.elementProfiles).toEqual(before.sample.elementProfiles)
  expect(next.selectedLayer).toBe(3)
  expect(next.selectedElement).toBe(state.selectedElement)
  expect(next.project.fit.parameters.slice(0, 2)).toEqual(before.fit.parameters.slice(0, 2))
  expect(next.project.fit.parameters).toHaveLength(3)
  expect(next.project.fit.parameters[2].index).toBe(2)
  expect(next.project.sample.depthProfileFunctions[0].boundToLayer).toBe(3)
  expect(next.fitEpoch).toBeGreaterThan(state.fitEpoch)
  expect(next.history.past).toHaveLength(1)
  expect(reducer(next, { type: 'undo' }).project).toEqual(before)
  expect(reducer(reducer(next, { type: 'undo' }), { type: 'redo' }).project).toEqual(next.project)
  layers[0].dielectricTensor!.values[0] = 123
  expect(next.project.sample.layers[0].dielectricTensor!.values[0]).toBe(.5)
  expect(state.project).toEqual(before)
})

it('distinguishes valid single-row conversion from invalid engine data without padding or mutating the project', () => {
  const project = createDefaultProject()
  project.sample.mode = 'element'
  const before = structuredClone(project)
  expect(() => applyLayerConversion(project, [createLayer()])).toThrow('Conversion produced one layer')
  expect(() => applyLayerConversion(project, [createLayer({ delta: NaN })])).toThrow('invalid layer list')
  expect(() => applyLayerConversion(project, [])).toThrow('invalid layer list')
  expect(project).toEqual(before)
})
