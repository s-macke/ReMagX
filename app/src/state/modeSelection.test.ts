import { expect, it } from 'vitest'
import { initialState, reducer } from './appState'

for (const mode of ['compound', 'element'] as const) {
  it(`normalizes selection when switching from ${mode}, including undo/redo`, () => {
    const state = initialState()
    state.project.sample.mode = mode
    state.project.sample.layers = state.project.sample.layers.slice(0, mode === 'compound' ? 6 : 3)
    state.project.sample.elementProfiles = [{ element: 'Co', f1: 2, f2: 1, f1Mag: 0, f2Mag: 0,
      slabs: Array.from({ length: mode === 'element' ? 6 : 3 }, () => ({ thickness: 10, density: 1, roughness: 0 })) }]
    state.selectedLayer = 4
    const sample = structuredClone(state.project.sample)
    const switched = reducer(state, { type: 'updateProject', update: p => ({ ...p, sample: { ...p.sample, mode: mode === 'compound' ? 'element' : 'compound' } }) })
    expect(switched.selectedLayer).toBe(2)
    expect(switched.project.sample.layers).toEqual(sample.layers)
    expect(switched.project.sample.elementProfiles).toEqual(sample.elementProfiles)
    const added = reducer(switched, { type: 'insertLayer' })
    expect(mode === 'compound' ? added.project.sample.elementProfiles[0].slabs.length : added.project.sample.layers.length).toBe(4)
    let restored = reducer(switched, { type: 'undo' })
    restored = reducer(restored, { type: 'selectLayer', index: 4 })
    restored = reducer(restored, { type: 'redo' })
    expect(restored.selectedLayer).toBe(2)
    expect(restored.project).toEqual(switched.project)
  })
}

it('keeps a valid selection and handles switching to an empty element stack', () => {
  const state = initialState()
  const switched = reducer(state, { type: 'updateProject', update: p => ({ ...p, sample: { ...p.sample, mode: 'element' } }) })
  expect(switched.selectedLayer).toBe(0)
  expect(switched.selectedElement).toBe(0)
  const returned = reducer(switched, { type: 'undo' })
  expect(returned.selectedLayer).toBe(0)
})
