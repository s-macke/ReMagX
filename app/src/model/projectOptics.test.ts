import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { prepareStandaloneQz } from './standaloneQz'
import { prepareStandaloneEnergyScan } from './standaloneEnergyScan'
import type { RealCalculationEngine } from './realCalculation'
import type { ScatteringTensorRequest } from './scatteringTensors'
import type { OpticalTable } from '../import/tables'

function setup() {
  const project = createDefaultProject()
  project.sample.mode = 'element'
  project.calculation.automaticOpticalConstants = true
  project.sample.elementProfiles = [{ element: 'Fe', f1: 7, f2: 8, f1Mag: 9, f2Mag: 10, slabs: [] }]
  const table: OpticalTable = { name: 'Fe', kind: 'ff', energy: [1, 10000], columns: [[20, 20], [2, 2]], warnings: [] }
  const lookup = vi.fn((_table: OpticalTable, _queries: number[], cursor: number) => ({ values: new Float64Array([20, 2]), cursor: cursor + 1 }))
  const scatteringTensor = vi.fn((_request: ScatteringTensorRequest) => new Float64Array(18).fill(4))
  const engine: RealCalculationEngine = { lookup, scatteringTensor, calculate: vi.fn(), energyScan: vi.fn(),
    matrixQz: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(),
    dielectricTensor: vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })) }
  return { project, table, engine, lookup, scatteringTensor }
}

it('performs element GetState and strict refresh in order with shared cursors and isolated state', () => {
  const { project, table, engine, lookup, scatteringTensor } = setup()
  const original = structuredClone(project)
  const result = prepareStandaloneQz(project, [table], engine)
  expect(lookup.mock.calls.map(call => call[2])).toEqual([0, 1])
  expect(result.opticalState.cursors.get(table)).toBe(2)
  expect(result.project.sample.elementProfiles[0]).toMatchObject({ f1: 20, f2: 2, f1Mag: 0, f2Mag: 0 })
  expect(scatteringTensor).toHaveBeenCalledTimes(2)
  expect(scatteringTensor).toHaveBeenNthCalledWith(2, { factors: [20, 2, 0, 0],
    gamma: project.calculation.magnetization.direction.gamma, phi: project.calculation.magnetization.direction.phi,
    tensor: 0, magnetic: project.calculation.magnetization.mode === 'none' ? 0 : 1 })
  expect(result.opticalState.scatteringTensors![0]).toEqual(new Float64Array(18).fill(4))
  result.project.sample.elementProfiles[0].f1 = 99
  result.opticalState.scatteringTensors![0][0] = 99
  expect(project).toEqual(original)
})

it('rejects missing, empty, wrong-case and out-of-range element primary tables without publishing a result', () => {
  for (const kind of ['missing', 'empty', 'case', 'range'] as const) {
    const { project, table, engine } = setup()
    if (kind === 'empty') table.energy = []
    if (kind === 'case') table.name = 'fe'
    if (kind === 'range') table.energy = [1, 2]
    const snapshot = structuredClone(project)
    expect(() => prepareStandaloneQz(project, kind === 'missing' ? [] : [table], engine)).toThrow(/missing|outside/)
    expect(project).toEqual(snapshot)
  }
})

it('keeps manual qz constants but applies the unconditional energy-scan strict gate in element mode', () => {
  const { project, table, engine, lookup } = setup()
  project.calculation.automaticOpticalConstants = false
  expect(prepareStandaloneQz(project, [], engine).project.sample.elementProfiles[0].f1).toBe(7)
  expect(lookup).not.toHaveBeenCalled()
  expect(() => prepareStandaloneEnergyScan(project, [], engine)).toThrow('missing')
  expect(prepareStandaloneEnergyScan(project, [table], engine).project.sample.elementProfiles[0].f1).toBe(20)
  expect(lookup).toHaveBeenCalledTimes(1)
})
