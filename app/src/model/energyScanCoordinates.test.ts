import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { prepareEnergyCoordinates } from './energyScanCoordinates'
import type { OpticalTable } from '../import/tables'

function setup() {
  const project = createDefaultProject()
  project.sample.layers.forEach(layer => { layer.opticalTable = 'film' })
  project.experiment.energyScan = { energyMin: 100, energyMax: 200, fixed: 'qz', qz: .03, angle: 2 }
  project.experiment.qzScan.points = 4
  const tables: OpticalTable[] = [{ name: 'film', kind: 'db', energy: [120, 180], columns: [[0, 0], [0, 0]], warnings: [] }]
  return { project, tables }
}

it('intersects primary ranges and generates the legacy minimum-inclusive repeated-addition grid', () => {
  const { project, tables } = setup()
  const before = structuredClone({ project, tables })
  expect(prepareEnergyCoordinates(project, tables)).toEqual({ energy: [120, 135, 150, 165, 180], qz: Array(5).fill(.03) })
  expect({ project, tables }).toEqual(before)
  project.experiment.energyScan.energyMin = 120.1
  project.experiment.energyScan.energyMax = 121.1
  project.experiment.qzScan.points = 10
  const expected = []
  for (let value = 120.1; value <= 121.1; value += .1) expected.push(value)
  expect(prepareEnergyCoordinates(project, tables).energy).toEqual(expected)
})

it('limits by magnetic tables only with magnetization enabled and retains fixed-angle arithmetic', () => {
  const { project, tables } = setup()
  tables.push({ ...tables[0], kind: 'm', energy: [130, 170] })
  expect(prepareEnergyCoordinates(project, tables).energy[0]).toBe(120)
  project.calculation.magnetization.mode = 'add'
  project.experiment.energyScan.fixed = 'angle'
  const result = prepareEnergyCoordinates(project, tables)
  expect(result.energy).toEqual([130, 140, 150, 160, 170])
  expect(result.qz).toEqual(result.energy.map(energy => 2 * (2 * Math.PI / (12398.326 / energy)) * Math.sin(2 / 180 * Math.PI)))
})

it('uses explicit energy dataset selection, preserves order and shifts without mutating measurements', () => {
  const { project, tables } = setup()
  project.experiment.qzScan.useDatasetPoints = true
  expect(prepareEnergyCoordinates(project, tables).energy).toHaveLength(5)
  expect(() => prepareEnergyCoordinates(project, tables, true)).toThrow('matching')
  project.datasets = [{ title: '', comment: '', sourceFile: '', energy: 100, energyShift: 2, qzShift: .01,
    angularResolution: 0, intensityScale: 1, intensityOffset: 0, errorWeight: 1,
    polarization: project.experiment.polarization, active: true,
    columns: { energy: [150, 130, 150], qz: [.1, .2, .1], reflectivity: [1, 2, 3] } }]
  project.activeDatasetIndex = 0
  const before = structuredClone(project)
  expect(prepareEnergyCoordinates(project, [], true)).toEqual({ energy: [152, 132, 152], qz: [.1 + .01, .2 + .01, .1 + .01] })
  expect(project).toEqual(before)
  project.datasets[0].energyShift = 1e-10
  expect(prepareEnergyCoordinates(project, [], true).energy).toEqual([150, 130, 150])
  project.datasets[0].columns.energy = [150]
  expect(() => prepareEnergyCoordinates(project, [], true)).toThrow('matching')
})

it('rejects missing tables, disjoint or stalled ranges and excessive allocations', () => {
  const { project, tables } = setup()
  expect(() => prepareEnergyCoordinates(project, [])).toThrow('Missing')
  project.experiment.energyScan.energyMin = 190
  expect(() => prepareEnergyCoordinates(project, tables)).toThrow('overlapping')
  project.experiment.energyScan.energyMin = 180
  expect(() => prepareEnergyCoordinates(project, tables)).toThrow('distinct')
  project.experiment.energyScan.energyMin = 100
  project.experiment.qzScan.points = 1000001
  expect(() => prepareEnergyCoordinates(project, tables)).toThrow('intervals')
  project.experiment.qzScan.points = 100
  project.experiment.energyScan.energyMin = 1
  project.experiment.energyScan.energyMax = 1 + Number.EPSILON
  tables[0].energy = [1, 2]
  expect(() => prepareEnergyCoordinates(project, tables)).toThrow('too small')
})
