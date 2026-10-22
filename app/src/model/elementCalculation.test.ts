import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { calculateRealCurve, type RealCalculationEngine } from './realCalculation'
import { storedOpticalState } from './storedOpticalState'

it.each(['parratt', 'zak', 'matrix'] as const)('routes %s element qz after refresh and hooks without compound slicing', algorithm => {
  const project = createDefaultProject(); project.sample.mode = 'element'
  project.calculation.algorithm = algorithm
  project.calculation.automaticOpticalConstants = true
  project.calculation.roughnessModel = 'segmentation'
  project.calculation.segmentation.minThickness = 10
  project.calculation.segmentation.tolerance = 0
  project.sample.elementProfiles = [{ element: 'Fe', f1: 1, f2: 0, f1Mag: 0, f2Mag: 0,
    slabs: [{ thickness: 0, roughness: 0, density: 1 }, { thickness: 10, roughness: 0, density: 2 }, { thickness: 0, roughness: 0, density: 0 }] }]
  project.experiment.qzScan.points = 2
  project.scripts.enabled = true; project.scripts.beforeCalculation = 'test'
  const before = structuredClone(project), order: string[] = []
  const engine: RealCalculationEngine = {
    calculate: vi.fn(() => new Float64Array([.1, .2, .3, .4])), zakQz: vi.fn(() => new Float64Array([.1, .2, .3, .4])),
    matrixQz: vi.fn(() => new Float64Array([.1, .2, .3, .4])), energyScan: vi.fn(), zakEnergy: vi.fn(), matrixEnergy: vi.fn(),
    dielectricTensor: vi.fn(), scatteringTensor: vi.fn(() => new Float64Array(18).fill(2)),
    lookup: () => { order.push('refresh'); return { values: new Float64Array([3, 4]), cursor: 1 } },
    elementPreparation: { errorSamples: Array(1001).fill(0), density: request => {
      order.push('density'); expect(request.slabs[1][0]).toBe(20)
      return new Float64Array(request.positions.map(depth => depth + 31))
    }, optics: request => {
      expect(request.elements[0].slice(1)).toEqual([5, 4, 0, 0])
      if (algorithm === 'matrix') expect(request.scatteringTensors).toEqual([Array(18).fill(7)])
      return { opticalConstants: new Float64Array([request.elements[0][0] * 1e-6, 0, 0, 0]),
        dielectricTensor: algorithm === 'matrix' ? new Float64Array(18).fill(9) : null }
    } },
  }
  const result = calculateRealCurve(project, [{ name: 'Fe', kind: 'ff', energy: [1, 100000], columns: [[3, 3], [4, 4]], warnings: [] }], engine,
    'qz', 'monochromatic', storedOpticalState(project), (current, opticalState) => {
      order.push('hook'); expect(current.sample.elementProfiles[0].f1).toBe(3)
      const updated = structuredClone(current); updated.sample.elementProfiles[0].f1 = 5
      updated.sample.elementProfiles[0].slabs[1].thickness = 20
      return { project: updated, opticalState: { ...opticalState, scatteringTensors: [new Float64Array(18).fill(7)] } }
    })
  expect(order.slice(0, 3)).toEqual(['refresh', 'hook', 'density'])
  const request = vi.mocked(algorithm === 'matrix' ? engine.matrixQz : algorithm === 'zak' ? engine.zakQz : engine.calculate).mock.calls[0][0]
  expect(request.layers.length).toBeGreaterThan(2)
  if (algorithm === 'matrix') {
    const layers = vi.mocked(engine.matrixQz).mock.calls[0][0].layers
    expect(layers.every(layer => layer.anisotropic === 1)).toBe(true)
    expect(layers.every(layer => layer.values.slice(4).every(value => value === 9))).toBe(true)
  }
  expect(engine.dielectricTensor).not.toHaveBeenCalled()
  expect(result.opticalState.layers).toHaveLength(project.sample.layers.length)
  expect(result.opticalState.scatteringTensors![0]).toEqual(new Float64Array(18).fill(7))
  expect(project).toEqual(before)
  delete engine.elementPreparation
  const manual = structuredClone(project); manual.calculation.automaticOpticalConstants = false; manual.scripts.enabled = false
  expect(() => calculateRealCurve(manual, [], engine, 'qz', 'monochromatic')).toThrow('explicit error-function')
})
