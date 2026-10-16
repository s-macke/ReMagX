import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { calculateParrattEnergyScan } from './parrattEnergyScan'
import type { PreparedParrattQzRequest } from './parrattRequest'
import type { OpticalTable } from '../import/tables'

function setup() {
  const project = createDefaultProject()
  project.sample.layers.forEach(layer => { layer.opticalTable = 'sample' })
  project.experiment.energyScan.energyMin = 100
  project.experiment.energyScan.energyMax = 200
  project.experiment.qzScan.points = 2
  const tables: OpticalTable[] = [{ name: 'sample', kind: 'db', energy: [90, 210], columns: [[0, 1], [0, 1]], warnings: [] }]
  const lookup = vi.fn((_table: OpticalTable, queries: number[], cursor: number) => ({ values: new Float64Array([queries[0] / 10000, 0]), cursor: cursor + 1 }))
  const convolve = vi.fn((_energies: number[], values: Float64Array) => values.map(value => value * 2))
  const calculate = vi.fn((request: PreparedParrattQzRequest) => new Float64Array([request.energy / 1000, 0]))
  return { project, tables, lookup, calculate, convolve }
}

it('refreshes at every energy with persistent cursors, exact angular convolution and immutable inputs', () => {
  const { project, tables, lookup, calculate, convolve } = setup()
  const before = structuredClone(project)
  expect(project.calculation.automaticOpticalConstants).toBe(false)
  expect(calculateParrattEnergyScan(project, tables, lookup, calculate, convolve)).toMatchObject({ energy: [100, 150, 200], reflectivity: [.1, .15, .2] })
  expect(lookup.mock.calls.map(call => call[2])).toEqual(Array.from({ length: project.sample.layers.length * 3 }, (_, i) => i))
  expect(calculate.mock.calls.every(([request]) => !request.resolution.fast && request.qz.length === 1)).toBe(true)
  expect(calculate.mock.calls.map(([request]) => request.layers[0][2])).toEqual([.01, .015, .02])
  expect(project).toEqual(before)
})

it('retains the legacy intensity of one for out-of-range dataset points and postprocesses the complete scan', () => {
  const { project, tables, lookup, calculate, convolve } = setup()
  project.experiment.qzScan.useDatasetPoints = true
  project.datasets = [{ title: '', comment: '', sourceFile: '', energy: 100, energyShift: 0, qzShift: 0,
    angularResolution: 0, intensityScale: 1, intensityOffset: 0, errorWeight: 1,
    polarization: project.experiment.polarization, active: true,
    columns: { energy: [50, 150, 250], qz: [.1, .2, .3], reflectivity: [0, 0, 0] } }]
  project.activeDatasetIndex = 0
  const result = calculateParrattEnergyScan(project, tables, lookup, calculate, convolve)
  expect(result.reflectivity).toEqual([1, .15, 1])
  expect(calculate).toHaveBeenCalledTimes(1)
  project.calculation.averaging = 1
  expect(calculateParrattEnergyScan(project, tables, lookup, calculate, convolve).reflectivity).toEqual([0, 2.15 / 3, 1.15 / 2])
  project.experiment.resolution.energyFwhm = 1
  expect(calculateParrattEnergyScan(project, tables, lookup, calculate, convolve).reflectivity).toEqual([0, 4.3 / 3, 2.3 / 2])
  expect(convolve).toHaveBeenCalledTimes(1)
  expect(convolve.mock.calls[0][0]).toEqual([50, 150, 250])
})

it('preserves both energy beams and computes asymmetry after energy convolution', () => {
  const { project, tables, lookup, convolve } = setup()
  project.experiment.resolution.energyFwhm = .5
  project.calculation.magnetization.mode = 'add'
  const calculate = vi.fn((request: PreparedParrattQzRequest) => {
    expect(request.mode).toBe(1)
    expect(request.magnetic).toBe(1)
    expect(request.beam2).not.toBeNull()
    expect(request.resolution.fast).toBe(false)
    return new Float64Array([3, 1])
  })
  const result = calculateParrattEnergyScan(project, tables, lookup, calculate, convolve, 'dichroic')
  expect(result.reflectivityPlus).toEqual([6, 6, 6])
  expect(result.reflectivityMinus).toEqual([2, 2, 2])
  expect(result.asymmetry).toEqual([.5, .5, .5])
  project.calculation.asymmetryDefinition = 'difference'
  expect(calculateParrattEnergyScan(project, tables, lookup, calculate, convolve, 'dichroic').asymmetry).toEqual([4, 4, 4])
})
