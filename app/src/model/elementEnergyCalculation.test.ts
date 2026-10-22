import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { calculateRealCurve, type RealCalculationEngine } from './realCalculation'
import { storedOpticalState } from './storedOpticalState'
import type { OpticalTable } from '../import/tables'

it.each(['parratt', 'zak', 'matrix'] as const)('prepares serial %s element energy stacks after refresh/hooks and skips invalid points', algorithm => {
  for (const mode of ['monochromatic', 'dichroic'] as const) {
    const project = createDefaultProject(); project.sample.mode = 'element'
    project.calculation.algorithm = algorithm; project.calculation.automaticOpticalConstants = false
    project.calculation.roughnessModel = 'segmentation'
    project.calculation.segmentation.minThickness = 10; project.calculation.segmentation.tolerance = 0
    project.sample.elementProfiles = ['A', 'B'].map(element => ({ element, f1: 1, f2: 0, f1Mag: 0, f2Mag: 0,
      slabs: [{ thickness: 0, roughness: 0, density: 1 }, { thickness: 10, roughness: 0, density: 2 }, { thickness: 0, roughness: 0, density: 0 }] }))
    project.scripts.enabled = true; project.scripts.beforeCalculation = 'hook'
    project.experiment.qzScan.useDatasetPoints = true
    project.datasets = [{ title: '', comment: '', sourceFile: '', active: true, errorWeight: 1, energy: 130,
      energyShift: 0, qzShift: 0, angularResolution: 0, intensityScale: 1, intensityOffset: 0,
      polarization: project.experiment.polarization,
      columns: { energy: [130, 110, 150, 130], qz: [.01, .02, .03, .01], reflectivity: [1, 1, 1, 1] } }]
    project.activeDatasetIndex = 0
    const before = structuredClone(project)
    const tables: OpticalTable[] = ['A', 'B'].map(name => ({ name, kind: 'ff', energy: name === 'A' ? [100, 200] : [120, 180], columns: [[1, 2], [0, 0]], warnings: [] }))
    const engine: RealCalculationEngine = {
      calculate: vi.fn(), zakQz: vi.fn(), matrixQz: vi.fn(), dielectricTensor: vi.fn(),
      energyScan: vi.fn(() => new Float64Array(8).fill(.1)), zakEnergy: vi.fn(() => new Float64Array(8).fill(.1)),
      matrixEnergy: vi.fn(() => new Float64Array(8).fill(.1)),
      lookup: vi.fn((_table, energy, cursor) => ({ values: new Float64Array([energy[0] / 10, 0]), cursor: cursor + 1 })),
      scatteringTensor: request => new Float64Array(18).fill(request.factors[0]),
      elementPreparation: { errorSamples: Array(1001).fill(0), density: request => new Float64Array(request.positions.map(depth => depth + 31)),
        optics: request => ({ opticalConstants: new Float64Array([request.elements[0][0] * 1e-6, 0, 0, 0]),
          dielectricTensor: request.scatteringTensors ? new Float64Array(request.scatteringTensors[0]) : null }) },
    }
    const hooks: string[] = []
    const result = calculateRealCurve(project, tables, engine, 'energy', mode, storedOpticalState(project), (current, state, _renew, lifetime) => {
      hooks.push(lifetime!)
      const updated = structuredClone(current)
      updated.sample.elementProfiles[0].slabs[1].thickness += 10
      updated.experiment.energy += 1
      return { project: updated, opticalState: { ...state, scatteringTensors: [new Float64Array(18).fill(99), state.scatteringTensors![1]] } }
    })
    expect(hooks).toEqual(['temporary', 'existing', 'existing', 'existing'])
    const request = algorithm === 'matrix' ? vi.mocked(engine.matrixEnergy).mock.calls[0][0]
      : algorithm === 'zak' ? vi.mocked(engine.zakEnergy).mock.calls[0][0] : vi.mocked(engine.energyScan).mock.calls[0][0]
    expect(request.enabled).toEqual([1, 0, 1, 1])
    expect(request.energy).toEqual([130, 110, 150, 130])
    expect(request.stacks[1]).toHaveLength(2)
    expect(request.stacks[2].length).toBeGreaterThan(request.stacks[0].length)
    expect(request.stacks[3].length).toBeGreaterThan(request.stacks[2].length)
    expect(request.pointSettings!.map(row => row[0])).toEqual(mode === 'dichroic' ? [130, 110, 150, 130] : [131, 110, 151, 131])
    if (algorithm === 'matrix') {
      const states = vi.mocked(engine.matrixEnergy).mock.calls[0][0].stacks
      expect(states[0].every(row => row.anisotropic === 1 && row.values.slice(4).every(value => value === 99))).toBe(true)
    }
    expect(engine.dielectricTensor).not.toHaveBeenCalled()
    expect(vi.mocked(engine.lookup).mock.calls.map(call => call[0].name)).toEqual(['A', 'B', 'A', 'A', 'B', 'A', 'B'])
    expect(result.opticalState.cursors.get(tables[0])).toBe(4)
    expect(result.opticalState.cursors.get(tables[1])).toBe(3)
    expect(result.opticalState.layers).toHaveLength(project.sample.layers.length)
    expect(project).toEqual(before)
  }
})
