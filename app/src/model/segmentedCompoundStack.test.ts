import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { prepareSegmentedCompoundStack } from './segmentedCompoundStack'
import type { SegmentationEngine } from './segmentedLayers'
import type { MagneticProfileEngine } from './segmentedMagneticProfiles'

function fixture() {
  const project = createDefaultProject()
  project.sample.layers = [createLayer(), createLayer({ thickness: 30, roughness: 2 }), createLayer()]
  project.sample.multilayer = { enabled: true, pattern: '2*(1)' }
  project.calculation.roughnessModel = 'segmentation'
  project.calculation.magnetization.mode = 'profile'
  project.sample.depthProfileFunctions = [{ center: 1, width: 2, deltaAmplitude: 3, betaAmplitude: 4,
    boundToLayer: 1, amplitudeCoupledTo: null, widthCoupledTo: null, spline: { enabled: false, points: [] } }]
  const sample = vi.fn<SegmentationEngine['sample']>(() => ({ opticalConstants: new Float64Array(4), dielectricTensor: new Float64Array(18) }))
  const subdivide = vi.fn<SegmentationEngine['subdivide']>(request => {
    request.sample(1, 0)
    return { positions: new Float64Array([0, 2, 4, 6, 8]), thicknesses: new Float64Array([0, 2, 2, 2, 2]), values: new Float64Array(request.valueCount * 5).fill(1) }
  })
  const density = vi.fn<MagneticProfileEngine['density']>(() => new Float64Array(4).fill(.5))
  const apply = vi.fn<MagneticProfileEngine['apply']>(request => Float64Array.from(request.initialValues, value => value + 1))
  return { project, engine: { sample, subdivide, density, apply } }
}

it('copies stored depths through multilayers independently of edited thickness and keeps generated tensors', () => {
  const { project, engine } = fixture()
  project.calculation.algorithm = 'matrix'
  project.calculation.profileCombination = 'product'
  const tensors = project.sample.layers.map((_, index) => ({ values: new Float64Array(18).fill(index), anisotropic: index === 1 }))
  const before = structuredClone(project)
  const result = prepareSegmentedCompoundStack(project, [0, 7, 7], Array(1001).fill(0), engine, tensors)
  expect(engine.sample.mock.calls[0][0].layers.map(layer => layer[0])).toEqual([0, 30, 30, 0])
  expect(engine.sample.mock.calls[0][0].tensors!.map(row => row[0])).toEqual([0, 1, 1, 2])
  expect(engine.density.mock.calls[0][0]).toMatchObject({ boundaries: [0, 7, 7, 7], layerIndex: 2, roughness: [0, 2, 2, 0], positions: [1, 3, 5, 7] })
  expect(engine.apply.mock.calls[0][0].coupled).toBe(1)
  expect(result.layers.map(layer => layer[4])).toEqual([1, 2, 2, 2, 2])
  expect(result.dielectricTensors.map(tensor => tensor!.values[0])).toEqual([1, 1, 1, 1, 1])
  expect(result.dielectricTensors.map(tensor => tensor!.anisotropic)).toEqual([false, true, true, true, false])
  expect(project).toEqual(before)
})

it('segments scalar paths without evaluating profiles in non-profile modes', () => {
  for (const mode of ['none', 'add'] as const) {
    const { project, engine } = fixture()
    project.calculation.algorithm = 'zak'
    project.calculation.magnetization.mode = mode
    prepareSegmentedCompoundStack(project, [0, 7, 7], Array(1001).fill(0), engine)
    expect(engine.sample.mock.calls[0][0].tensors).toBeNull()
    expect(engine.apply).not.toHaveBeenCalled()
    expect(engine.density).not.toHaveBeenCalled()
  }
})

it('rejects missing geometry or matrix state before numerical work', () => {
  const { project, engine } = fixture()
  expect(() => prepareSegmentedCompoundStack(project, [0, 7], Array(1001).fill(0), engine)).toThrow('Stored layer depths')
  project.calculation.algorithm = 'matrix'
  expect(() => prepareSegmentedCompoundStack(project, [0, 7, 7], Array(1001).fill(0), engine)).toThrow('Stored dielectric tensors')
  project.calculation.roughnessModel = 'nevot-croce'
  expect(() => prepareSegmentedCompoundStack(project, [0, 7, 7], Array(1001).fill(0), engine)).toThrow('requires compound')
  expect(engine.subdivide).not.toHaveBeenCalled()
})
