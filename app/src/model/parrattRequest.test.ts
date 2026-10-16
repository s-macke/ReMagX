import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { prepareParrattQzRequest, prepareQzCoordinates } from './parrattRequest'
import type { Project } from './project'

it('uses the legacy minimum-exclusive maximum-inclusive grid, including reversed and constant ranges', () => {
  const project = createDefaultProject()
  Object.assign(project.experiment.qzScan, { qzMin: 1, qzMax: 5, points: 4 })
  expect(prepareQzCoordinates(project)).toEqual([2, 3, 4, 5])
  Object.assign(project.experiment.qzScan, { qzMin: 5, qzMax: 1 })
  expect(prepareQzCoordinates(project)).toEqual([4, 3, 2, 1])
  project.experiment.qzScan.qzMin = 1
  expect(prepareQzCoordinates(project)).toEqual([1, 1, 1, 1])
  project.experiment.qzScan.points = 1000001
  expect(() => prepareQzCoordinates(project)).toThrow('points')
})

it('preserves dataset point order and repeats, applies only significant qz shifts, and never mutates measured data', () => {
  const project = createDefaultProject()
  project.experiment.qzScan.useDatasetPoints = true
  expect(() => prepareQzCoordinates(project)).toThrow('active dataset')
  project.datasets = [{ title: '', comment: '', sourceFile: '', energy: 100,
    energyShift: 8, angularResolution: 3, intensityScale: 4, intensityOffset: 5, qzShift: .25,
    errorWeight: 1, polarization: project.experiment.polarization, active: true,
    columns: { qz: [.5, -.5, .5], reflectivity: [1, 2, 3] } }]
  project.activeDatasetIndex = 0
  const before = structuredClone(project)
  expect(prepareQzCoordinates(project)).toEqual([.75, -.25, .75])
  expect(project).toEqual(before)
  project.datasets[0].qzShift = -1e-10
  expect(prepareQzCoordinates(project)).toEqual([.5, -.5, .5])
  project.datasets[0].qzShift = -2e-10
  expect(prepareQzCoordinates(project)[0]).toBe(.5 - 2e-10)
  project.datasets[0].columns.qz = []
  expect(() => prepareQzCoordinates(project)).toThrow('qz coordinates')
})

it('maps both complex beams without normalization and produces independent numeric inputs', () => {
  const project = createDefaultProject()
  project.experiment.polarization = { beam1: { sigma: { re: 2, im: 3 }, pi: { re: 4, im: 5 } },
    beam2: { sigma: { re: 6, im: 7 }, pi: { re: 8, im: 9 } }, analyzer: 'pi' }
  project.calculation.tensorContribution = 'tetragonal'
  project.calculation.magnetization.mode = 'add'
  const before = structuredClone(project)
  const prepared = prepareParrattQzRequest(project, 'dichroic')
  expect(prepared.beam1).toEqual([2, 3, 4, 5])
  expect(prepared.beam2).toEqual([6, 7, 8, 9])
  expect([prepared.mode, prepared.magnetic, prepared.tensor, prepared.analyzer]).toEqual([1, 1, 1, 2])
  prepared.layers[0][0] = 200
  prepared.qz[0] = 20
  expect(prepared.resolution).toEqual({ width: 0, fast: true })
  prepared.resolution.width = 8
  prepared.beam1[0] = 0
  expect(project).toEqual(before)
  const mono = prepareParrattQzRequest(project, 'monochromatic')
  expect(mono.mode).toBe(0)
  expect(mono.beam2).toBeNull()
  expect(mono.energy).toBe(project.experiment.energy)
})

it('rejects unfinished physics and preprocessing instead of silently calculating a different project', () => {
  const changes: ((project: Project) => void)[] = [
    p => { p.calculation.algorithm = 'zak' }, p => { p.sample.mode = 'element' },
    p => { p.experiment.scattering = 'transmission' }, p => { p.calculation.automaticOpticalConstants = true },
    p => { p.scripts.beforeCalculation = 'SetEnergy(100)' },
    p => { p.calculation.roughnessModel = 'segmentation' },
    p => { p.calculation.postProcessing.fourierTransform = true },
  ]
  for (const change of changes) {
    const project = createDefaultProject()
    change(project)
    expect(() => prepareParrattQzRequest(project, 'monochromatic')).toThrow()
  }
  const project = createDefaultProject()
  project.scripts.enabled = false
  project.scripts.beforeCalculation = 'SetEnergy(100)'
  expect(() => prepareParrattQzRequest(project, 'monochromatic')).not.toThrow()
})

it('preserves the stricter fast-dichroic upper boundary', () => {
  const project = createDefaultProject()
  const limit = 2 * (2 * Math.PI / (12398.326 / project.experiment.energy))
  project.experiment.qzScan.qzMin = limit
  project.experiment.qzScan.qzMax = limit
  expect(() => prepareParrattQzRequest(project, 'dichroic')).toThrow('boundary')
  project.experiment.resolution.fastConvolution = false
  expect(prepareParrattQzRequest(project, 'dichroic').qz[0]).toBe(limit)
})
