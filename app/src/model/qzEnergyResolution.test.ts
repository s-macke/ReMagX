import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { calculateRealCurve, type RealBeforeCalculation, type RealCalculationEngine } from './realCalculation'
import { HC_EV_ANGSTROM } from './units'

function fixture() {
  const project = createDefaultProject()
  project.calculation.automaticOpticalConstants = false
  project.calculation.roughnessModel = 'nevot-croce'
  project.experiment.qzScan = { ...project.experiment.qzScan, points: 3, qzMin: .02, qzMax: .1, useDatasetPoints: false }
  project.experiment.resolution.energyFwhm = 30
  const calculate = vi.fn((request: { qz: number[]; energy: number }) => new Float64Array(request.qz.flatMap(() => [1, 0])))
  const engine: RealCalculationEngine = { calculate, zakQz: calculate, matrixQz: calculate,
    lookup: vi.fn(), energyScan: vi.fn(), zakEnergy: vi.fn(), matrixEnergy: vi.fn(),
    dielectricTensor: vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })) }
  return { project, engine, calculate }
}

it('broadens at fixed angles, returns the original grid and energy, and preserves inputs', () => {
  const { project, engine, calculate } = fixture()
  const before = structuredClone(project)
  const result = calculateRealCurve(project, [], engine, 'qz', 'monochromatic')
  expect(calculate).toHaveBeenCalledTimes(19)
  for (const [request] of calculate.mock.calls) {
    const energy = request.energy
    request.qz.forEach((qz, i) => expect(qz / energy).toBeCloseTo(result.qz[i] / project.experiment.energy, 14))
  }
  expect(result.reflectivityPlus.every(value => Math.abs(value - 1) < 1e-10)).toBe(true)
  expect(result.finalEnergy).toBe(project.experiment.energy)
  expect(result.scriptedProject?.experiment.energy).toBe(project.experiment.energy)
  expect(project).toEqual(before)
})

it('retains the original threshold and the distinct two-beam entry point', () => {
  const { project, engine, calculate } = fixture()
  for (const width of [0, 1e-6]) {
    project.experiment.resolution.energyFwhm = width
    calculate.mockClear()
    calculateRealCurve(project, [], engine, 'qz', 'monochromatic')
    expect(calculate).toHaveBeenCalledTimes(1)
  }
  project.experiment.resolution.energyFwhm = 30
  calculate.mockClear()
  calculateRealCurve(project, [], engine, 'qz', 'dichroic')
  expect(calculate).toHaveBeenCalledTimes(1)
})

it('uses fresh temporary hooks while retaining existing fit hooks and their state', () => {
  const { project, engine } = fixture()
  project.scripts.enabled = true
  project.scripts.beforeCalculation = 'counter test'
  const seen: number[] = []
  let counter = 0
  const hook: RealBeforeCalculation = (current, state) => {
    seen.push(++counter)
    return { project: current, opticalState: state }
  }
  const close = vi.fn()
  hook.createTemporary = () => {
    let localCounter = 0
    return { hook: (current, state) => { seen.push(++localCounter); return { project: current, opticalState: state } }, close }
  }
  calculateRealCurve(project, [], engine, 'qz', 'monochromatic', undefined, hook)
  expect(seen).toEqual(Array(19).fill(1))
  expect(close).toHaveBeenCalledTimes(19)
  seen.length = 0
  calculateRealCurve(project, [], engine, 'qz', 'monochromatic', undefined, hook, 'existing')
  expect(seen).toEqual(Array.from({ length: 19 }, (_, i) => i + 1))
  expect(close).toHaveBeenCalledTimes(19)
})

it('rejects the original angular boundary and unsafe Fourier composition without evaluating physics', () => {
  const { project, engine, calculate } = fixture()
  project.calculation.postProcessing.fourierTransform = true
  expect(() => calculateRealCurve(project, [], engine, 'qz', 'monochromatic')).toThrow('Fourier')
  project.calculation.postProcessing.fourierTransform = false
  const wave = 2 * Math.PI / (HC_EV_ANGSTROM / project.experiment.energy)
  project.experiment.qzScan.qzMax = 2 * wave * 1.1
  expect(() => calculateRealCurve(project, [], engine, 'qz', 'monochromatic')).toThrow('boundary')
  expect(calculate).not.toHaveBeenCalled()
})

it('closes temporary script sessions on a failed sample without changing the input', () => {
  const { project, engine, calculate } = fixture()
  const before = structuredClone(project)
  const close = vi.fn()
  const hook: RealBeforeCalculation = (current, state) => ({ project: current, opticalState: state })
  hook.createTemporary = () => ({ hook, close })
  calculate.mockImplementationOnce(request => new Float64Array(request.qz.flatMap(() => [1, 0])))
    .mockImplementationOnce(() => { throw new Error('sample failed') })
  expect(() => calculateRealCurve(project, [], engine, 'qz', 'monochromatic', undefined, hook)).toThrow('sample failed')
  expect(close).toHaveBeenCalledTimes(2)
  expect(project).toEqual(before)
})
