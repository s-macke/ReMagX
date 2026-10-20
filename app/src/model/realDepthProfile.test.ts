import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { depthProfileFromLayers, realDepthProfile } from './realDepthProfile'
import { profilePlot } from './profileView'
import type { RealCalculationEngine } from './realCalculation'

it('maps actual boundaries to legacy smooth and illustrated optical/magnetic curves', () => {
  const profile = depthProfileFromLayers([
    [0, 0, 1, 2, -1, -2, 90, 90], [2, 0, 3, 4, -3, -4, 90, 90],
    [3, 0, 5, 6, -5, -6, 90, 90], [2, 0, 7, 8, -7, -8, 90, 90],
  ], [-2, 0, 3, 5])
  expect(() => depthProfileFromLayers(Array.from({ length: 3 }, () => [0, 0, 1e308, 0, 0, 0, 90, 90]), [0, 1, 2])).toThrow('Nonfinite')
  expect(profile.z).toEqual([-2, 0, 3])
  expect(profile.delta).toEqual([1, 4, 6])
  expect(profile.betaMag).toEqual([-2, -5, -7])
  expect(profile.segments).toHaveLength(2)
  const plot = profilePlot(profile, true, true)
  expect(plot.x).toEqual([-2, -2, -2, -2, 0, 0, 0, 0, 3])
  expect(plot.series[0].y).toEqual([-1, -3, 0, -3, -3, -5, 0, -5, -5])
  expect(plot.yLabel).toContain('real slices')
  expect(profilePlot(profile, false, false).series[0].y).toEqual([1, 4, 6])
  expect(() => depthProfileFromLayers([], [])).toThrow('Invalid')
  expect(() => depthProfileFromLayers([[0, 0, 1, 2, 0, 0, 90, 90]], [NaN])).toThrow('Invalid')
})

it('refreshes strictly before one script hook, then forces slicing without altering the project', () => {
  const project = createDefaultProject()
  project.sample.layers = [createLayer({ opticalTable: 'A' }), createLayer({ opticalTable: 'A', thickness: 5 }), createLayer({ opticalTable: 'A' })]
  project.calculation.automaticOpticalConstants = true
  project.calculation.roughnessModel = 'nevot-croce'
  project.experiment.energy = 650
  project.scripts.enabled = true; project.scripts.beforeCalculation = 'synthetic hook'
  const before = structuredClone(project)
  const sample = vi.fn(() => ({ opticalConstants: new Float64Array(4), dielectricTensor: null }))
  const lookup = vi.fn(() => ({ values: new Float64Array([.01, .02]), cursor: 1 }))
  const engine: RealCalculationEngine = { calculate: vi.fn(), energyScan: vi.fn(), matrixQz: vi.fn(), matrixEnergy: vi.fn(),
    zakQz: vi.fn(), zakEnergy: vi.fn(), lookup, dielectricTensor: vi.fn(), segmentation: {
      errorSamples: Array(1001).fill(0), sample, density: vi.fn(), apply: vi.fn(), subdivide: request => {
        request.sample(0, 0)
        expect(request.maximumDepth).toBe(38)
        return { positions: new Float64Array([-30, 0, 38]), thicknesses: new Float64Array([0, 30, 38]), values: new Float64Array(12).fill(.25) }
      },
    } }
  const hook = vi.fn((current, opticalState) => {
    expect(lookup).toHaveBeenCalledTimes(6)
    expect(current.sample.layers[1].delta).toBe(.01)
    expect(current.calculation.roughnessModel).toBe('nevot-croce')
    const next = structuredClone(current); next.sample.layers[1].thickness = 8; next.sample.layers[1].delta = .8
    return { project: next, opticalState }
  })
  const tables = [{ name: 'A', kind: 'db' as const, energy: [600, 700], columns: [[.01, .01], [.02, .02]], warnings: [] }]
  expect(realDepthProfile(project, tables, engine, hook).engine).toBe('real')
  expect(hook).toHaveBeenCalledTimes(1)
  expect(sample.mock.calls[0]).toBeDefined()
  expect(lookup).toHaveBeenCalledTimes(6)
  expect(project).toEqual(before)
  expect(() => realDepthProfile(project, tables, engine)).toThrow('BeforeCalculation')
  project.scripts.enabled = false
  expect(() => realDepthProfile(project, tables, { ...engine, segmentation: undefined })).toThrow('explicit error-function')
})
