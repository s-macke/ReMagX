import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { applyMaterialSettings, readMaterialSettings } from './materialSettings'
import { createFitParameter } from './fitTargets'
import { initialState, reducer } from '../state/appState'

it('applies material edits and both fit flags atomically without changing read-only fields', () => {
  const project = createDefaultProject()
  const initial = readMaterialSettings(project, 1)!
  const draft = { ...initial, formula: 'CoO', density: 6.5, gamma: 37, phi: 42, fitGamma: true, fitPhi: true }
  const changed = applyMaterialSettings(project, 1, initial, draft)
  expect(changed.sample.layers[1]).toEqual({ ...project.sample.layers[1], material: 'CoO', density: 6.5, magnetization: { gamma: 37, phi: 42 } })
  expect(changed.fit.parameters.map(parameter => [parameter.target, parameter.index, parameter.value])).toEqual([['magnetizationGamma', 1, 37], ['magnetizationPhi', 1, 42]])
  expect(changed.calculation).toBe(project.calculation)
  expect(changed.sample.layers[2]).toBe(project.sample.layers[2])
  expect(readMaterialSettings(project, 1)).toEqual(initial)
  let state = initialState()
  state = reducer(state, { type: 'updateProject', update: p => applyMaterialSettings(p, 1, initial, draft) })
  expect(state.history.past).toHaveLength(1)
  expect(reducer(state, { type: 'undo' }).project).toEqual(project)
})

it('preserves concurrent edits and existing fit bounds unless their controls were changed', () => {
  const project = createDefaultProject()
  project.fit.parameters = [{ ...createFitParameter(project, 'magnetizationGamma', 1, null), lowerBound: -180, upperBound: 180, step: 3 }]
  const initial = readMaterialSettings(project, 1)!
  const latest = structuredClone(project)
  latest.sample.layers[1].magnetization.gamma = 61
  latest.sample.layers[1].delta = 0.02
  const changed = applyMaterialSettings(latest, 1, initial, { ...initial, formula: 'CoO' })
  expect(changed.sample.layers[1].magnetization.gamma).toBe(61)
  expect(changed.sample.layers[1].delta).toBe(0.02)
  expect(changed.fit).toBe(latest.fit)
  expect(applyMaterialSettings(latest, 1, initial, initial)).toBe(latest)
  const off = applyMaterialSettings(latest, 1, initial, { ...initial, fitGamma: false })
  expect(off.fit.parameters).toHaveLength(0)
})

it('rejects invalid numeric drafts and ignores missing layers or element-mode projects', () => {
  const project = createDefaultProject()
  const initial = readMaterialSettings(project, 1)!
  for (const patch of [{ density: -1 }, { gamma: Infinity }, { phi: NaN }]) expect(() => applyMaterialSettings(project, 1, initial, { ...initial, ...patch })).toThrow('finite')
  expect(readMaterialSettings(project, 99)).toBeNull()
  expect(applyMaterialSettings(project, 99, initial, { ...initial, formula: 'Ni' })).toBe(project)
  project.sample.mode = 'element'
  expect(readMaterialSettings(project, 1)).toBeNull()
})
