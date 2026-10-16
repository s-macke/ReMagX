import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { calculateVisnovskyEnergyScan, type PreparedVisnovskyEnergyScan } from './visnovskyEnergyScan'
import type { OpticalTable } from '../import/tables'

function setup() {
  const project = createDefaultProject()
  project.calculation.algorithm = 'matrix'
  project.calculation.magnetization.mode = 'add'
  project.sample.layers.forEach(layer => { layer.opticalTable = 'sample' })
  project.experiment.energyScan.energyMin = 100
  project.experiment.energyScan.energyMax = 200
  project.experiment.qzScan.points = 2
  project.experiment.resolution.angularFwhm = .001
  project.experiment.resolution.energyFwhm = .5
  const tables: OpticalTable[] = [{ name: 'sample', kind: 'db', energy: [90, 210], columns: [[.01, .02], [.001, .002]], warnings: [] }]
  const lookup = vi.fn((_table: OpticalTable, queries: number[], cursor: number) => ({ values: new Float64Array([queries[0] / 10000, .001]), cursor: cursor + 1 }))
  const construct = vi.fn(() => ({ values: new Float64Array(18).fill(.2), anisotropic: true }))
  const calculate = vi.fn((request: PreparedVisnovskyEnergyScan) => new Float64Array(request.energy.flatMap((_, index) => request.enabled[index] ? [6, 2] : [1, 1])))
  return { project, tables, lookup, construct, calculate }
}

it('constructs refreshed per-energy tensors, retains cursors, and postprocesses both convolved beams', () => {
  const { project, tables, lookup, construct, calculate } = setup()
  const before = structuredClone(project)
  const result = calculateVisnovskyEnergyScan(project, tables, lookup, construct, calculate, 'dichroic')
  expect(result.energy).toEqual([100, 150, 200])
  expect(result.asymmetry).toEqual([.5, .5, .5])
  const request = calculate.mock.calls[0][0]
  expect(request).toMatchObject({ angularWidth: .001, energyWidth: .5, mode: 1, epsilon: project.calculation.epsilon })
  expect(request.stacks.map(stack => stack[0].values[2])).toEqual([.99, .985, .98])
  expect(construct).toHaveBeenCalledTimes(3 * project.sample.layers.length)
  expect(lookup.mock.calls.map(call => call[2])).toEqual(Array.from({ length: 3 * project.sample.layers.length }, (_, index) => index))
  expect(project).toEqual(before)
  project.calculation.asymmetryDefinition = 'difference'
  expect(calculateVisnovskyEnergyScan(project, tables, lookup, construct, calculate, 'dichroic').asymmetry).toEqual([4, 4, 4])
})

it('skips tensor construction for range failures and validates unsupported settings even when all points are skipped', () => {
  const { project, tables, lookup, construct, calculate } = setup()
  project.experiment.qzScan.useDatasetPoints = true
  project.datasets = [{ title: '', comment: '', sourceFile: '', energy: 100, energyShift: 0, qzShift: 0,
    angularResolution: 0, intensityScale: 1, intensityOffset: 0, errorWeight: 1,
    polarization: project.experiment.polarization, active: true,
    columns: { energy: [50, 150, 250], qz: [.1, .2, .3], reflectivity: [0, 0, 0] } }]
  project.activeDatasetIndex = 0
  expect(calculateVisnovskyEnergyScan(project, tables, lookup, construct, calculate, 'dichroic').asymmetry).toEqual([0, .5, 0])
  expect(construct).toHaveBeenCalledTimes(project.sample.layers.length)
  const request = calculate.mock.calls[0][0]
  expect(request.enabled).toEqual([0, 1, 0])
  expect(request.stacks[0][0]).toEqual({ values: [0, 0, 1, ...Array<number>(19).fill(0)], anisotropic: 0 })
  project.datasets[0].columns.energy = [10, 20, 30]
  project.calculation.magnetization.mode = 'profile'
  expect(() => calculateVisnovskyEnergyScan(project, tables, lookup, construct, calculate)).toThrow('profile')
  expect(calculate).toHaveBeenCalledTimes(1)
})
