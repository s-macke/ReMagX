import { expect, it } from 'vitest'
import { createDefaultProject, createDepthProfileFunction } from './defaults'
import { applyValueSlider, readValueCell, type ValueCell, type ValueSliderSelection } from './valueSlider'
import { initialState, reducer } from '../state/appState'

it('scales from a fixed baseline through zero and four times, including negative and zero values', () => {
  const project = createDefaultProject()
  const selection: ValueSliderSelection = { target: { kind: 'layer', index: 1, field: 'thickness' }, label: 'thickness', originalValue: 10, position: 250 }
  const twice = applyValueSlider(project, selection, 500)
  expect(twice.sample.layers[1].thickness).toBe(20)
  expect(applyValueSlider(twice, selection, 750).sample.layers[1].thickness).toBe(30)
  expect(applyValueSlider(twice, selection, 1000).sample.layers[1].thickness).toBe(40)
  expect(applyValueSlider(twice, selection, 0).sample.layers[1].thickness).toBe(0)
  project.scripts.parameters = [-2, 0]
  for (const index of [0, 1]) {
    const target: ValueCell = { kind: 'script', index }
    const result = applyValueSlider(project, { ...selection, target, originalValue: project.scripts.parameters[index] }, 1000)
    expect(result.scripts.parameters[index]).toBe(project.scripts.parameters[index] * 4)
  }
  expect(project.sample.layers[1].thickness).toBe(10)
  expect(applyValueSlider(project, { ...selection, originalValue: Number.MAX_VALUE }, 1000)).toBe(project)
})

it('rejects excluded cells and preserves unrelated profile, spline and element values', () => {
  const project = createDefaultProject()
  for (const target of [
    { kind: 'layer', index: 0, field: 'thickness' },
    { kind: 'layer', index: 13, field: 'thickness' },
    { kind: 'layer', index: 13, field: 'roughness' },
  ] as const) expect(readValueCell(project, target)).toBeUndefined()
  project.sample.depthProfileFunctions = [createDepthProfileFunction()]
  project.sample.depthProfileFunctions[0].spline = { enabled: true, points: Array.from({ length: 9 }, (_, z) => ({ z, value: 1 })) }
  const target: ValueCell = { kind: 'spline', profile: 0, index: 4 }
  const result = applyValueSlider(project, { target, label: 'y2', originalValue: 1, position: 250 }, 500)
  expect(result.sample.depthProfileFunctions[0].spline.points.map(p => p.value)).toEqual([1, 1, 1, 1, 2, 1, 1, 1, 1])
  expect(readValueCell(project, { ...target, index: 1 })).toBeUndefined()
  expect(readValueCell(project, { kind: 'profile', index: 0, field: 'center' })).toBeUndefined()
  project.sample.mode = 'element'
  project.sample.elementProfiles = ['Co', 'Ni'].map(element => ({ element, f1: 1, f2: 0, f1Mag: 0, f2Mag: 0,
    slabs: Array.from({ length: 3 }, () => ({ thickness: 10, density: 2, roughness: 1 })) }))
  const slab: ValueCell = { kind: 'slab', element: 1, index: 1, field: 'density' }
  const changed = applyValueSlider(project, { target: slab, label: 'density', originalValue: 2, position: 250 }, 500)
  expect(changed.sample.elementProfiles.map(e => e.slabs[1].density)).toEqual([2, 4])
})

it('coalesces one drag, resets the baseline after typing, and clears targets after undo/load/structure changes', () => {
  const target: ValueCell = { kind: 'layer', index: 1, field: 'thickness' }
  let state = reducer(initialState(), { type: 'selectValueCell', target, label: 'thickness' })
  for (const position of [500, 750, 1000]) state = reducer(state, { type: 'slideValue', position, coalesce: 'drag:1' })
  expect(state.project.sample.layers[1].thickness).toBe(40)
  expect(state.history.past).toHaveLength(1)
  state = reducer(state, { type: 'undo' })
  expect(state.project.sample.layers[1].thickness).toBe(10)
  expect(state.valueSlider).toBeNull()
  state = reducer(state, { type: 'selectValueCell', target, label: 'thickness' })
  state = reducer(state, { type: 'updateLayer', index: 1, patch: { thickness: 15 } })
  expect(state.valueSlider?.originalValue).toBe(15)
  expect(state.valueSlider?.position).toBe(250)
  expect(reducer(state, { type: 'insertLayer' }).valueSlider).toBeNull()
  expect(reducer(state, { type: 'loadProject', project: createDefaultProject(), fileName: 'new.json' }).valueSlider).toBeNull()
})
