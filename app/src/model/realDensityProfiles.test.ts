import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { realDensityProfiles } from './realDensityProfiles'
import { densityProfilePlot } from './densityProfileView'
import type { RealCalculationEngine } from './realCalculation'

function fixture() {
  const project = createDefaultProject()
  project.sample.mode = 'element'; project.scripts.enabled = false
  project.calculation.automaticOpticalConstants = false
  project.calculation.segmentation.minThickness = 10
  project.sample.elementProfiles = ['Fe', 'Co'].map((element, index) => ({ element, f1: 1, f2: 0, f1Mag: 0, f2Mag: 0,
    slabs: [{ thickness: 0, roughness: 100, density: .1 }, { thickness: 10, roughness: index ? 50 : 5, density: .2 },
      { thickness: 0, roughness: 0, density: 0 }] }))
  const density = vi.fn((request: { positions: number[] }) => new Float64Array(request.positions.map(value => value / 100)))
  const lookup = vi.fn(() => ({ values: new Float64Array([3, 4]), cursor: 0 }))
  const engine: RealCalculationEngine = { calculate: vi.fn(), energyScan: vi.fn(), matrixQz: vi.fn(), matrixEnergy: vi.fn(),
    zakQz: vi.fn(), zakEnergy: vi.fn(), lookup,
    dielectricTensor: vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })),
    scatteringTensor: vi.fn(() => new Float64Array(18)),
    elementPreparation: { errorSamples: Array(1001).fill(0), density, optics: vi.fn() } }
  return { project, engine, density, lookup }
}

it('uses the first thickest element roughness, exclusive repeated-addition grid and all boundary marks', () => {
  const { project, engine, density } = fixture(), before = structuredClone(project)
  const result = realDensityProfiles(project, [], engine)
  expect(result.z).toEqual([-30, -20, -10, 0, 10, 20, 30, 40]) // maximum 50 excluded
  expect(result.elements.map(element => element.boundaries)).toEqual(Array(2).fill([{ z: 0, density: 0 }, { z: 10, density: .1 }]))
  expect(density).toHaveBeenCalledTimes(2)
  expect(density.mock.calls[0][0].positions).toEqual([...result.z, 0, 10])
  expect(project).toEqual(before)
  const plot = densityProfilePlot({ ...result, scriptMessages: ['density'] })
  expect(plot.yLabel).toBe('density (real)'); expect(plot.scriptMessages).toEqual(['density'])
  expect(plot.boundaryMarks).toHaveLength(4)
  expect(densityProfilePlot({ ...result, engine: undefined }).yLabel).toBe('density (mock)')
  project.calculation.segmentation.minThickness = .3
  const repeated = realDensityProfiles(project, [], engine).z
  expect(repeated[2]).toBe((-30 + .3) + .3)
  expect(repeated.at(-1)).toBeLessThan(50)
})

it('performs initial partial refresh before one temporary hook, without a strict second refresh', () => {
  const { project, engine, density, lookup } = fixture()
  project.calculation.automaticOpticalConstants = true
  project.scripts.enabled = true; project.scripts.beforeCalculation = 'hook'
  project.experiment.energy = 800
  const tables = [{ name: 'Fe', kind: 'ff' as const, energy: [700, 900], columns: [[3, 3], [4, 4]], warnings: [] }]
  const before = structuredClone(project)
  const hook = vi.fn((current, opticalState, index, lifetime) => {
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(current.sample.elementProfiles.map((profile: { f1: number }) => profile.f1)).toEqual([3, 1])
    expect(index).toBe(0); expect(lifetime).toBe('temporary')
    current.sample.elementProfiles[0].slabs[1].thickness = 20
    current.sample.elementProfiles[0].slabs[1].density = current.sample.elementProfiles[0].f1
    return { project: current, opticalState }
  })
  const result = realDensityProfiles(project, tables, engine, hook)
  expect(result.z.at(-1)).toBe(50)
  expect(density.mock.calls[0][0]).toMatchObject({ slabs: [[0, 100, .1], [20, 5, 3], [0, 0, 0]] })
  expect(lookup).toHaveBeenCalledTimes(1); expect(hook).toHaveBeenCalledTimes(1)
  expect(project).toEqual(before)
  expect(() => realDensityProfiles(project, tables, engine)).toThrow('BeforeCalculation')
})

it('rejects undefined original ranges, invalid grids and malformed native results explicitly', () => {
  const { project, engine, density } = fixture()
  expect(() => realDensityProfiles(project, [], { ...engine, elementPreparation: undefined })).toThrow('explicit error-function')
  expect(() => realDensityProfiles(project, [], engine, undefined, 2)).toThrow('supported limit')
  project.calculation.segmentation.minThickness = 1e-30
  expect(() => realDensityProfiles(project, [], engine)).toThrow('does not advance')
  project.calculation.segmentation.minThickness = 0
  expect(() => realDensityProfiles(project, [], engine)).toThrow('sampling settings')
  project.calculation.segmentation.minThickness = 10
  density.mockReturnValue(new Float64Array([NaN]))
  expect(() => realDensityProfiles(project, [], engine)).toThrow('Invalid native')
  project.sample.elementProfiles.forEach(profile => { profile.slabs[1].thickness = 0 })
  expect(() => realDensityProfiles(project, [], engine)).toThrow('undefined without a positive')
})
