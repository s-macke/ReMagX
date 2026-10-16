import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { postprocessParrattResult } from './parrattResult'

it('applies qz-fourth before asymmetry and averages the original asymmetry independently', () => {
  const project = createDefaultProject()
  project.calculation.postProcessing.multiplyByQz4 = true
  project.calculation.averaging = 1
  const input = new Float64Array([3, 1, 1, 1, 0, 0])
  const result = postprocessParrattResult(project, [1, 2, 3], input)
  expect(result.reflectivityPlus).toEqual([0, 19 / 3, 8])
  expect(result.reflectivityMinus).toEqual([0, 17 / 3, 8])
  expect(result.asymmetry).toEqual([0, .5 / 3, 0])
  expect(Array.from(input)).toEqual([3, 1, 1, 1, 0, 0])
  project.calculation.asymmetryDefinition = 'difference'
  expect(postprocessParrattResult(project, [1, 2, 3], input).asymmetry).toEqual([0, 2 / 3, 0])
})

it('corrects only the exact legacy pure-pi beam, including its boundary fallback', () => {
  const project = createDefaultProject()
  project.calculation.postProcessing.divideByCos2ThetaSquared = true
  project.experiment.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
  project.experiment.polarization.beam2 = { sigma: { re: 0, im: 0 }, pi: { re: 0, im: 1 } }
  const wave = 2 * Math.PI / (12398.326 / project.experiment.energy)
  const qz = [2 * wave * Math.sin(Math.PI / 6), 2 * wave]
  const result = postprocessParrattResult(project, qz, new Float64Array([1, 2, 1, 2]))
  expect(result.reflectivityPlus[0]).toBeCloseTo(4, 12)
  expect(result.reflectivityPlus[1]).toBe(1 / (Math.cos(-2) * Math.cos(-2)))
  expect(result.reflectivityMinus).toEqual([2, 2])
  project.experiment.polarization.beam1.pi.re = 2
  expect(postprocessParrattResult(project, qz, new Float64Array([1, 2, 1, 2])).reflectivityPlus).toEqual([1, 1])
})

it('uses shifted per-point dataset energies only when calculating on dataset coordinates', () => {
  const project = createDefaultProject()
  project.experiment.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
  project.calculation.postProcessing.divideByCos2ThetaSquared = true
  project.experiment.qzScan.useDatasetPoints = true
  project.activeDatasetIndex = 0
  project.datasets = [{ title: '', comment: '', sourceFile: '', energy: 1, energyShift: 10,
    angularResolution: 0, intensityScale: 1, intensityOffset: 0, qzShift: 0, errorWeight: 1,
    polarization: project.experiment.polarization, active: true, columns: { qz: [.01, .02], energy: [100, 200] } }]
  const actual = postprocessParrattResult(project, [.01, .02], new Float64Array([1, 0, 1, 0]))
  const expected = [110, 210].map((energy, index) => {
    const angle = Math.asin([.01, .02][index] / (2 * (2 * Math.PI / (12398.326 / energy))))
    return 1 / (Math.cos(2 * angle) * Math.cos(2 * angle))
  })
  expect(actual.reflectivityPlus).toEqual(expected)
  project.datasets[0].columns.energy = [0, 0]
  project.datasets[0].energyShift = 0
  project.experiment.polarization.beam2 = project.experiment.polarization.beam1
  project.experiment.polarization.beam1 = { sigma: { re: 1, im: 0 }, pi: { re: 0, im: 0 } }
  expect(postprocessParrattResult(project, [0, 0], new Float64Array([1, 0, 1, 0]), 'monochromatic').reflectivityPlus).toEqual([1, 1])
})

it('preserves leading zero windows and trailing clipping, and rejects nonfinite postprocessing', () => {
  const project = createDefaultProject()
  project.calculation.averaging = 100
  expect(postprocessParrattResult(project, [1, 2], new Float64Array([2, 0, 4, 0])).reflectivityPlus).toEqual([0, 0])
  project.calculation.postProcessing.multiplyByQz4 = true
  expect(() => postprocessParrattResult(project, [1e100], new Float64Array([1, 0]))).toThrow()
  project.calculation.postProcessing.fourierTransform = true
  expect(() => postprocessParrattResult(project, [1], new Float64Array([1, 0]))).toThrow('Fourier')
})
