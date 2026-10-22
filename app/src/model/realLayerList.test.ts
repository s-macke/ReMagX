import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { realLayerList } from './realLayerList'
import type { RealCalculationEngine } from './realCalculation'

function engine(): RealCalculationEngine {
  return { calculate: vi.fn(), energyScan: vi.fn(), matrixQz: vi.fn(), matrixEnergy: vi.fn(),
    zakQz: vi.fn(), zakEnergy: vi.fn(), lookup: vi.fn(),
    dielectricTensor: () => ({ values: new Float64Array(18).fill(2), anisotropic: true }) }
}

it('retains adaptive row scalars, terminal thickness and tensor classifications with generated defaults', () => {
  const project = createDefaultProject()
  project.calculation.algorithm = 'matrix'
  project.calculation.automaticOpticalConstants = false
  project.sample.layers = [createLayer({ density: 7 }), createLayer({ thickness: 5, material: 'source', electronEscapeDepth: 9 }), createLayer()]
  const original = structuredClone(project)
  const tensors = Array.from({ length: 3 }, (_, row) => Array.from({ length: 18 }, (_, column) => row + column / 100))
  const core = engine()
  core.segmentation = { errorSamples: Array(1001).fill(0), sample: vi.fn(), density: vi.fn(), apply: vi.fn(),
    subdivide: () => ({ positions: new Float64Array([-30, 0, 35]), thicknesses: new Float64Array([0, 30, 35]),
      values: new Float64Array(tensors.flatMap((tensor, index) => [index + .1, .2, -.3, -.4, ...tensor])) }) }
  const result = realLayerList(project, [], core)
  expect(result.map(layer => layer.thickness)).toEqual([0, 30, 35])
  expect(result.map(layer => layer.dielectricTensor?.anisotropic)).toEqual([false, true, false])
  result.forEach((layer, index) => {
    expect(layer).toMatchObject({ material: '', opticalTable: 'unknown', density: 0, electronEscapeDepth: 0,
      roughness: 0, delta: index + .1, beta: .2, deltaMag: -.3, betaMag: -.4, magnetization: { gamma: 90, phi: 90 } })
    expect(layer.dielectricTensor?.values).toEqual(tensors[index])
  })
  expect(project).toEqual(original)
})

it('preserves a compressed single element row and script-updated global direction without mutating input', () => {
  const project = createDefaultProject()
  project.sample.mode = 'element'
  project.calculation.algorithm = 'parratt'
  project.calculation.automaticOpticalConstants = false
  project.calculation.segmentation.minThickness = 10
  project.scripts.enabled = true
  project.scripts.beforeCalculation = 'synthetic hook'
  const original = structuredClone(project)
  const core = engine()
  core.elementPreparation = { errorSamples: Array(1001).fill(0), density: () => new Float64Array([0]),
    optics: () => ({ opticalConstants: new Float64Array([.01, .02, -.03, -.04]), dielectricTensor: null }) }
  const hook = vi.fn((current, opticalState) => {
    current.calculation.magnetization.direction = { gamma: 12, phi: 34 }
    return { project: current, opticalState }
  })
  const result = realLayerList(project, [], core, hook)
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ thickness: 0, opticalTable: 'unknown', delta: .01, betaMag: -.04,
    magnetization: { gamma: 12, phi: 34 } })
  expect(result[0].dielectricTensor).toBeUndefined()
  expect(hook).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.anything(), 0, 'temporary')
  expect(project).toEqual(original)
  expect(() => realLayerList(project, [], core)).toThrow('BeforeCalculation')
  expect(() => realLayerList(project, [], { ...core, elementPreparation: undefined }, hook)).toThrow('explicit error-function')
})
