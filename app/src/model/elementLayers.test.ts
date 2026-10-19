import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { prepareElementLayers, type ElementOpticsCalculator } from './elementLayers'
import { HC_EV_ANGSTROM } from './units'

function fixture() {
  const project = createDefaultProject(); project.sample.mode = 'element'
  project.calculation.segmentation.minThickness = 10
  project.calculation.segmentation.tolerance = 1
  project.sample.elementProfiles = [{ element: 'Fe', f1: 1, f2: 2, f1Mag: 3, f2Mag: 4, slabs: [] }]
  return project
}

it('uses threshold-start reference values but retains the latest sample and includes the final thickness', () => {
  const project = fixture()
  const density = vi.fn((_profile, depth: number) => depth)
  let index = 0
  const values = [0, 1, 2, 2.5, 3, 4, 4.5]
  const calculate: ElementOpticsCalculator = request => {
    expect(request.elements[0]).toEqual([-30 + index * 10, 1, 2, 3, 4])
    expect(request.scatteringTensors).toBeNull()
    const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy)
    expect(request.factor).toBe((.0004151761541 * 1e6) / (energy * energy))
    return { opticalConstants: new Float64Array([values[index++], 0, 0, 0]), dielectricTensor: null }
  }
  const before = structuredClone(project)
  const result = prepareElementLayers(project, density, calculate)
  expect(result.samples).toBe(7)
  expect(result.positions).toEqual([-20, 10, 30])
  expect(result.layers.map(layer => [layer[0], layer[2]])).toEqual([[0, 1], [30, 3], [20, 4.5]])
  expect(project).toEqual(before)
})

it('takes terminal roughness from the first strictly thickest profile and ignores tensor-only changes for splitting', () => {
  const project = fixture(); project.calculation.algorithm = 'matrix'
  const slab = (thickness: number, roughness: number) => ({ thickness, roughness, density: 1 })
  project.sample.elementProfiles[0].slabs = [slab(999, 0), slab(10, 2), slab(999, 0)]
  project.sample.elementProfiles.push({ ...project.sample.elementProfiles[0], slabs: [slab(0, 0), slab(10, 100), slab(0, 0)] })
  const supplied = [new Float64Array(18).fill(2), new Float64Array(18).fill(3)]
  const shared = new Float64Array(18)
  const result = prepareElementLayers(project, () => 1, request => {
    expect(request.scatteringTensors).toEqual(supplied.map(value => Array.from(value)))
    shared[0]++
    return { opticalConstants: new Float64Array(4), dielectricTensor: shared }
  }, supplied)
  // maximum depth = 10 + 30 + 2*2; repeated-addition grid ends at 40.
  expect(result.samples).toBe(8)
  expect(result.positions).toEqual([40])
  expect(result.dielectricTensors[0]![0]).toBe(8)
  shared.fill(99)
  expect(result.dielectricTensors[0]![0]).toBe(8)
})

it('rejects nonadvancing, oversized and invalid preparation without publishing partial layers', () => {
  const project = fixture()
  const calculate = vi.fn(() => ({ opticalConstants: new Float64Array(4), dielectricTensor: null }))
  expect(() => prepareElementLayers(project, () => NaN, calculate)).toThrow('density')
  expect(calculate).not.toHaveBeenCalled()
  expect(() => prepareElementLayers(project, () => 1, calculate, [], 2)).toThrow('limit')
  project.calculation.segmentation.minThickness = Number.MIN_VALUE
  expect(() => prepareElementLayers(project, () => 1, calculate)).toThrow('does not advance')
  project.calculation.segmentation.minThickness = 0
  expect(() => prepareElementLayers(project, () => 1, calculate)).toThrow('settings')
  project.calculation.segmentation.minThickness = 10
  project.calculation.algorithm = 'matrix'
  expect(() => prepareElementLayers(project, () => 1, calculate)).toThrow('match')
  expect(() => prepareElementLayers(project, () => 1, calculate, [new Float64Array(18)])).toThrow('optics')
})
