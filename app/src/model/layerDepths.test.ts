import { expect, it } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { copyLayerDepths, rebuildLayerDepths } from './layerDepths'
import { storedOpticalState } from './storedOpticalState'

it('captures dtoz geometry once, ignores substrate thickness and includes ambient thickness', () => {
  const project = createDefaultProject()
  project.sample.layers = [createLayer({ thickness: 999 }), createLayer({ thickness: 7 }), createLayer({ thickness: 5 })]
  const state = storedOpticalState(project)
  expect(state.layerDepths).toEqual([0, 7, 12])
  project.sample.layers[1].thickness = 40
  const retained = copyLayerDepths(project, state.layerDepths)
  expect(retained).toEqual([0, 7, 12])
  retained[1] = 100
  expect(state.layerDepths).toEqual([0, 7, 12])
  expect(copyLayerDepths(project)).toEqual([0, 40, 45])
  expect(rebuildLayerDepths(project, 4)).toEqual([4, 44, 49])
})

it('validates snapshots without sorting or rebuilding stale depths and rejects overflow', () => {
  const project = createDefaultProject()
  project.sample.layers = Array.from({ length: 3 }, () => createLayer({ thickness: 1e308 }))
  expect(copyLayerDepths(project, [4, 2, 2])).toEqual([4, 2, 2])
  expect(() => copyLayerDepths(project)).toThrow('numerical range')
  expect(() => copyLayerDepths(project, [0, 1])).toThrow('layer count')
  expect(() => copyLayerDepths(project, [0, NaN, 2])).toThrow('layer count')
})
