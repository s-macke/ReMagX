import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import type { Dataset } from './project'
import { prepareFitDataset } from './fitDataset'
import { prepareQzCoordinates } from './parrattRequest'
import { prepareEnergyCoordinates } from './energyScanCoordinates'

function fixture(): Dataset {
  return { title: '', comment: '', sourceFile: '', energy: 640, energyShift: 3,
    qzShift: .01, angularResolution: .002, intensityScale: 2, intensityOffset: .5,
    errorWeight: 4, active: true, polarization: createDefaultProject().experiment.polarization,
    columns: { qz: [.2, .1, .3], reflectivity: [1, 2, 3] } }
}
it('prepares measurements and per-dataset experiment settings without double shifts or sorting', () => {
  const project = createDefaultProject(); project.datasets = [fixture()]
  const before = structuredClone(project)
  const result = prepareFitDataset(project, 0)
  expect(result.measurement.reflectivity).toEqual([3, 5, 7])
  expect(result.measurement.qz).toEqual([.2 + .01, .1 + .01, .3 + .01])
  expect(prepareQzCoordinates(result.project)).toEqual(result.measurement.qz)
  expect(result.project.experiment.energy).toBe(640) // no scalar energy shift in Adapt
  expect(result.project.experiment.polarization).toEqual(project.datasets[0].polarization)
  expect(result.project.experiment.resolution.angularFwhm).toBe(.002)
  expect(result).toMatchObject({ errorMode: 0, scan: 'qz', beams: 'monochromatic', weight: 4 })
  expect(project).toEqual(before)
  project.datasets[0].columns.energy = [620, 630, 640]
  const energy = prepareFitDataset(project, 0)
  expect(prepareEnergyCoordinates(energy.project, [])).toEqual({ energy: [623, 633, 643], qz: energy.measurement.qz })
  project.datasets[0].qzShift = 1e-10; project.datasets[0].energyShift = -1e-10
  const tiny = prepareFitDataset(project, 0)
  expect(tiny.measurement.qz).toEqual(project.datasets[0].columns.qz)
  expect(tiny.measurement.energy).toEqual(project.datasets[0].columns.energy)
})
it('selects legacy column precedence and eight objective modes independently of display selection', () => {
  const project = createDefaultProject(); const data = fixture(); project.datasets = [data]
  data.columns.asymmetry = [-1, 0, 1]
  data.columns.reflectivityPlus = [2, 3, 4]; data.columns.reflectivityMinus = [1, 2, 3]
  for (const energyScan of [false, true]) {
    if (energyScan) data.columns.energy = [600, 610, 620]
    for (const linear of [false, true]) {
      project.fit.errorFunction = linear ? 'lin-chi2' : 'log-chi2'
      expect(prepareFitDataset(project, 0).errorMode).toBe((energyScan ? 4 : 0) + Number(linear))
    }
  }
  delete data.columns.reflectivity
  expect(prepareFitDataset(project, 0).errorMode).toBe(6)
  delete data.columns.energy
  expect(prepareFitDataset(project, 0).errorMode).toBe(2)
  delete data.columns.asymmetry
  expect(prepareFitDataset(project, 0)).toMatchObject({ errorMode: 3, beams: 'dichroic' })
  data.columns.energy = [600, 610, 620]
  expect(prepareFitDataset(project, 0).errorMode).toBe(7)
  expect(prepareFitDataset(project, 0).measurement.asymmetry).toBeUndefined()
})
it('preserves standalone asymmetry and applies averaging after rebuilding an existing asymmetry column', () => {
  const project = createDefaultProject(); const data = fixture(); project.datasets = [data]
  data.columns = { qz: [1, 2, 3], asymmetry: [-1, .2, 1] }
  expect(prepareFitDataset(project, 0).measurement.asymmetry).toEqual([-1, .2, 1])
  data.qzShift = 0; data.intensityOffset = 0; data.intensityScale = 1
  data.columns.reflectivityPlus = [3, 1, 0]; data.columns.reflectivityMinus = [1, 1, 0]
  project.calculation.postProcessing.multiplyByQz4 = true; project.calculation.averaging = 1
  const result = prepareFitDataset(project, 0)
  expect(result.measurement.reflectivityPlus).toEqual([0, 19 / 3, 8])
  expect(result.measurement.asymmetry).toEqual([0, .5 / 3, 0])
})
it('rejects malformed/unsupported inputs and numerical overflow without modifying the project', () => {
  const project = createDefaultProject(); project.datasets = [fixture()]
  expect(() => prepareFitDataset(project, -1)).toThrow()
  project.datasets[0].columns.reflectivity = [1]
  expect(() => prepareFitDataset(project, 0)).toThrow()
  project.datasets[0] = fixture(); project.datasets[0].intensityScale = 1e308
  const before = structuredClone(project)
  expect(() => prepareFitDataset(project, 0)).toThrow()
  expect(project).toEqual(before)
  project.datasets[0] = fixture(); project.calculation.postProcessing.fourierTransform = true
  expect(() => prepareFitDataset(project, 0)).toThrow('Fourier')
  project.calculation.postProcessing.fourierTransform = false
  project.datasets[0].columns = { qz: [1], electronYield: [1] }
  expect(() => prepareFitDataset(project, 0)).toThrow('supported')
})
