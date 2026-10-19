import { expect, it } from 'vitest'
import { createDefaultProject } from '../src/model/defaults'
import type { Dataset } from '../src/model/project'
import { prepareScriptReflectivityInput } from '../src/model/scriptReflectivity'

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
