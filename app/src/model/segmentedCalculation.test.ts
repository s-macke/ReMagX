import { expect, it, vi } from 'vitest'
import type { MagneticProfileEngine } from './segmentedMagneticProfiles'
import { createDefaultProject, createLayer } from './defaults'
import { calculateRealCurve, type RealCalculationEngine } from './realCalculation'
import { prepareParrattQzRequest } from './parrattRequest'

function fixture() {
  const project = createDefaultProject()
  project.sample.layers = [createLayer(), createLayer({ thickness: 7 }), createLayer()]
  project.sample.multilayer.enabled = false
  project.sample.depthProfileFunctions = [{ center: 0, width: 2, deltaAmplitude: 1, betaAmplitude: 2, boundToLayer: 1,
    amplitudeCoupledTo: null, widthCoupledTo: null, spline: { enabled: false, points: [] } }]
  project.calculation.roughnessModel = 'segmentation'
  project.calculation.automaticOpticalConstants = false
  project.calculation.magnetization.mode = 'profile'
  project.experiment.qzScan.points = 2
  const engine: RealCalculationEngine = {
    calculate: vi.fn(() => new Float64Array([.1, .2, .3, .4])), zakQz: vi.fn(() => new Float64Array([.1, .2, .3, .4])),
    matrixQz: vi.fn(() => new Float64Array([.1, .2, .3, .4])), energyScan: vi.fn(), zakEnergy: vi.fn(), matrixEnergy: vi.fn(), lookup: vi.fn(),
    dielectricTensor: vi.fn(() => ({ values: new Float64Array(18).fill(9), anisotropic: true })),
    segmentation: { errorSamples: Array(1001).fill(0),
      sample: vi.fn(() => ({ opticalConstants: new Float64Array(4).fill(.01), dielectricTensor: new Float64Array(18).fill(5) })),
      subdivide: vi.fn(request => {
        const values = request.sample(1, 0)
        return { positions: new Float64Array([0, 2, 4, 6]), thicknesses: new Float64Array([0, 2, 2, 2]), values: new Float64Array(Array(4).fill(values).flat()) }
      }), density: vi.fn(() => new Float64Array(3).fill(.5)),
      apply: vi.fn<MagneticProfileEngine['apply']>(request => Float64Array.from(request.initialValues, value => value + 1)),
    },
  }
  return { project, engine }
}

it.each(['parratt', 'zak', 'matrix'] as const)('routes segmented %s requests after Lua while retaining original state geometry', algorithm => {
  const { project, engine } = fixture()
  project.calculation.algorithm = algorithm
  project.scripts.enabled = true; project.scripts.beforeCalculation = 'test hook'
  const before = structuredClone(project)
  const result = calculateRealCurve(project, [], engine, 'qz', 'dichroic', undefined, (current, opticalState) => ({
    project: { ...current, sample: { ...current.sample, layers: current.sample.layers.map((layer, index) => index === 1 ? { ...layer, thickness: 30 } : layer) } },
    opticalState: { ...opticalState, dielectricState: current.sample.layers.map(() => ({ values: new Float64Array(18).fill(4), anisotropic: true })) },
  }))
  expect(vi.mocked(engine.segmentation!.density).mock.calls[0][0].boundaries).toEqual([0, 7, 7])
  expect(vi.mocked(engine.segmentation!.sample).mock.calls[0][0].layers[1][0]).toBe(30)
  const call = algorithm === 'matrix' ? vi.mocked(engine.matrixQz).mock.calls[0][0] : algorithm === 'zak' ? vi.mocked(engine.zakQz).mock.calls[0][0] : vi.mocked(engine.calculate).mock.calls[0][0]
  expect(call.layers).toHaveLength(4)
  expect(result.opticalState.layerDepths).toEqual([0, 7, 7])
  expect(result.opticalState.layers).toHaveLength(3)
  expect(result.opticalState.layers[1].thickness).toBe(30)
  if (algorithm === 'matrix') {
    expect(engine.dielectricTensor).not.toHaveBeenCalled()
    const packed = vi.mocked(engine.matrixQz).mock.calls[0][0].layers
    expect(packed.map(layer => layer.anisotropic)).toEqual([0, 1, 1, 0])
    expect(packed[1].values.slice(4)).toEqual(Array(18).fill(5))
  } else {
    const packed = algorithm === 'zak' ? vi.mocked(engine.zakQz).mock.calls[0][0].layers : vi.mocked(engine.calculate).mock.calls[0][0].layers
    expect(packed.map(layer => layer[4])).toEqual([.01, 1.01, 1.01, 1.01])
    expect(engine.dielectricTensor).not.toHaveBeenCalled()
  }
  expect(project).toEqual(before)
})

it('keeps unavailable segmentation explicit and validates supplied calculation stacks', () => {
  const { project, engine } = fixture()
  delete engine.segmentation
  expect(() => calculateRealCurve(project, [], engine, 'qz', 'monochromatic')).toThrow('explicit error-function lookup')
  expect(engine.calculate).not.toHaveBeenCalled()
  expect(() => prepareParrattQzRequest(project, 'monochromatic', undefined, [])).toThrow('prepared compound')
  expect(() => prepareParrattQzRequest(project, 'monochromatic', undefined, [[0, 0, 0, 0, 0, 0, 90, 90], [0, -1, 0, 0, 0, 0, 90, 90]])).toThrow('prepared compound')
})
