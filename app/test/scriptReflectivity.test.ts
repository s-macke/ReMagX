import type { RealCalculationEngine } from '../src/model/realCalculation'
import { expect, it, vi } from 'vitest'
import { createDefaultProject } from '../src/model/defaults'
import type { Dataset } from '../src/model/project'
import { calculatePreparedScriptReflectivity, finishScriptReflectivityInput, prepareScriptReflectivityInput } from '../src/model/scriptReflectivity'

function fixture() {
  const project = createDefaultProject()
  const dataset: Dataset = { title: '', comment: '', sourceFile: '', energy: 300, energyShift: 2, qzShift: .5,
    angularResolution: 0, intensityScale: 3, intensityOffset: 2, active: false, errorWeight: 0,
    polarization: structuredClone(project.experiment.polarization),
    columns: { qz: [3, 1, 3], energy: [600, 500, 600], reflectivity: [1, 2, 3],
      reflectivityPlus: [4, 5, 6], reflectivityMinus: [7, 8, 9], electronYield: [10, 11, 12], asymmetry: [.1, .2, .3] } }
  project.datasets = [dataset]; project.activeDatasetIndex = 0
  project.experiment.qzScan.useDatasetPoints = true
  return { project, dataset }
}

it('preserves the Lua-specific generated grid, including its overshoot and ignored minimum', () => {
  const project = createDefaultProject()
  project.experiment.qzScan = { qzMin: 99, qzMax: 3, points: 4, useDatasetPoints: false }
  const result = prepareScriptReflectivityInput(project, 640)
  expect(result.columns).toEqual({ qz: [1, 2, 3, 4] })
  expect(result.energy).toBe(640)
})

it('adapts selected data without sorting, postprocessing or replacing stored experiment metadata', () => {
  const { project, dataset } = fixture()
  dataset.polarization.beam1.sigma.re = .25
  project.calculation.postProcessing.multiplyByQz4 = true
  const before = structuredClone(project)
  const result = prepareScriptReflectivityInput(project, 700)
  expect(result.columns).toEqual({ qz: [3.5, 1.5, 3.5], energy: [602, 502, 602],
    reflectivity: [9, 12, 15], reflectivityPlus: [18, 21, 24], reflectivityMinus: [27, 30, 33],
    electronYield: [36, 39, 42], asymmetry: [.1, .2, .3] })
  expect(result.energy).toBe(700)
  expect(result.polarization).toEqual(project.experiment.polarization)
  result.columns.qz[0] = 0; result.polarization.beam1.sigma.re = 0
  expect(project).toEqual(before)
})

it('retains the strict shift threshold, missing columns and empty selected datasets', () => {
  const { project, dataset } = fixture()
  dataset.qzShift = -1e-10; dataset.energyShift = 1e-10
  expect(prepareScriptReflectivityInput(project, 640).columns.qz).toEqual([3, 1, 3])
  expect(prepareScriptReflectivityInput(project, 640).columns.energy).toEqual([600, 500, 600])
  dataset.columns = { qz: [] }
  expect(prepareScriptReflectivityInput(project, 640).columns).toEqual({ qz: [] })
})

it('rejects absent selections, nonfinite adaptation and undefined generated grids', () => {
  const { project, dataset } = fixture()
  project.activeDatasetIndex = null
  expect(() => prepareScriptReflectivityInput(project, 640)).toThrow('no selected dataset')
  project.activeDatasetIndex = 0; dataset.intensityScale = 1e308
  expect(() => prepareScriptReflectivityInput(project, 640)).toThrow('nonfinite adapted data')
  project.experiment.qzScan.useDatasetPoints = false; project.experiment.qzScan.points = 1
  expect(() => prepareScriptReflectivityInput(project, 640)).toThrow('generated grid')
  expect(() => prepareScriptReflectivityInput(project, Infinity)).toThrow('stored energy')
})


it('keeps calculated R distinct from retained Rp and Rm before postprocessing', () => {
  const { project } = fixture()
  project.experiment.resolution.fastConvolution = false
  project.calculation.averaging = 0
  project.calculation.postProcessing = { multiplyByQz4: true, divideByCos2ThetaSquared: false, fourierTransform: false }
  const input = prepareScriptReflectivityInput(project, 640)
  const before = structuredClone(input)
  const result = finishScriptReflectivityInput(project, input, [1, 2, 3])
  expect(result.reflectivity).toEqual([1 * 3.5 ** 4, 2 * 1.5 ** 4, 3 * 3.5 ** 4])
  expect(result.reflectivityPlus).toEqual([18 * 3.5 ** 4, 21 * 1.5 ** 4, 24 * 3.5 ** 4])
  expect(result.reflectivityMinus).toEqual([27 * 3.5 ** 4, 30 * 1.5 ** 4, 33 * 3.5 ** 4])
  result.qz[0] = 0; result.energy[0] = 0
  expect(input).toEqual(before)
})

it('initializes missing Rp to ones and retains an empty Rm for generated scans', () => {
  const project = createDefaultProject()
  project.experiment.qzScan = { qzMin: 0, qzMax: .1, points: 2, useDatasetPoints: false }
  project.experiment.resolution.fastConvolution = false
  project.calculation.averaging = 0
  const input = prepareScriptReflectivityInput(project, 640)
  expect(finishScriptReflectivityInput(project, input, [.5, .25])).toMatchObject({
    reflectivity: [.5, .25], reflectivityPlus: [1, 1], reflectivityMinus: [], energy: [] })
  project.experiment.resolution.fastConvolution = true
  expect(() => finishScriptReflectivityInput(project, input, [.5, .25])).toThrow('fast-resolution samples')
  expect(finishScriptReflectivityInput(project, input, [.5, .25], [.6, .2]).reflectivityPlus).toEqual([.6, .2])
  expect(() => finishScriptReflectivityInput(project, input, [NaN, 1], [.6, .2])).toThrow('calculated reflectivity')
})

it('uses captured polarization and energy for correction after a hook changes global settings', () => {
  const project = createDefaultProject()
  project.experiment.qzScan = { qzMin: 0, qzMax: .1, points: 2, useDatasetPoints: false }
  project.experiment.resolution.fastConvolution = false
  project.calculation.averaging = 0
  project.experiment.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
  const input = prepareScriptReflectivityInput(project, 640)
  project.experiment.energy = 900
  project.experiment.polarization.beam1 = { sigma: { re: 1, im: 0 }, pi: { re: 0, im: 0 } }
  project.calculation.postProcessing.divideByCos2ThetaSquared = true
  const expected = input.columns.qz.map(qz => 1 / Math.cos(2 * Math.asin(qz / (4 * Math.PI / (12398.326 / 640)))) ** 2)
  const result = finishScriptReflectivityInput(project, input, [1, 1])
  expect(result.reflectivity).toEqual(expected)
  expect(result.reflectivityPlus).toEqual(expected)
})

it.each(['parratt', 'zak', 'matrix'] as const)('calculates captured coordinates with %s and preserves exact/fast solution columns', algorithm => {
  const { project, dataset } = fixture()
  project.calculation.algorithm = algorithm
  project.calculation.postProcessing = { multiplyByQz4: false, divideByCos2ThetaSquared: false, fourierTransform: false }
  project.calculation.averaging = 0
  dataset.columns = { qz: [.02, -.01, .03], reflectivityPlus: [7, 9, 11], reflectivityMinus: [4, 5, 6] }
  dataset.qzShift = 0; dataset.intensityOffset = 0; dataset.intensityScale = 1
  const input = prepareScriptReflectivityInput(project, 640)
  project.experiment.energy = 800
  const calculate = vi.fn((request: { qz: number[] }) => new Float64Array(request.qz.flatMap(value => [value * 10, 0])))
  const engine: RealCalculationEngine = { calculate, matrixQz: calculate, zakQz: calculate,
    energyScan: vi.fn(), matrixEnergy: vi.fn(), zakEnergy: vi.fn(), lookup: vi.fn(),
    dielectricTensor: () => ({ values: new Float64Array(18), anisotropic: false }),
    convolveFastQz: vi.fn((_qz, values) => values.map(value => value * 2)) }
  project.experiment.resolution.fastConvolution = false
  expect(calculatePreparedScriptReflectivity(project, input, engine)).toMatchObject({
    qz: [.02, -.01, .03], reflectivity: [.2, -.1, .3], reflectivityPlus: [7, 9, 11], reflectivityMinus: [4, 5, 6] })
  expect(calculate.mock.calls[0][0]).toMatchObject({ energy: 800, qz: [.02, -.01, .03] })
  project.experiment.resolution.fastConvolution = true
  const before = structuredClone({ input, project })
  expect(calculatePreparedScriptReflectivity(project, input, engine)).toMatchObject({
    reflectivity: [.4, 18, .6], reflectivityPlus: [.2, 9, .3], reflectivityMinus: [4, 5, 6] })
  expect(calculate.mock.calls[1][0]).toMatchObject({ qz: [.02, .03], resolution: { width: 0, fast: false } })
  expect(engine.convolveFastQz).toHaveBeenCalledWith([.02, -.01, .03], new Float64Array([.2, 0, 9, 0, .3, 0]), project.experiment.resolution.angularFwhm)
  expect({ input, project }).toEqual(before)
  const empty = { ...input, columns: { qz: [] } }
  expect(calculatePreparedScriptReflectivity(project, empty, engine).reflectivity).toEqual([])
  expect(calculate).toHaveBeenCalledTimes(2)
  const outside = { ...input, columns: { qz: [-1e10] } }
  expect(() => calculatePreparedScriptReflectivity(project, outside, engine)).toThrow('fast calculation boundary')
  expect(calculate).toHaveBeenCalledTimes(2)
  project.experiment.resolution.fastConvolution = false
  calculate.mockReturnValueOnce(new Float64Array([NaN, 0, 0, 0, 0, 0]))
  expect(() => calculatePreparedScriptReflectivity(project, input, engine)).toThrow('invalid native output')
  expect(input).toEqual(before.input)
})
