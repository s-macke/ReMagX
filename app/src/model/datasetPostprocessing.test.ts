import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { postprocessDatasetColumns } from './datasetPostprocessing'
import type { Dataset } from './project'

it('runs Fourier after corrections and averaging, changing only ordinary reflectivity and qz', () => {
  const project = createDefaultProject()
  project.calculation.postProcessing = { multiplyByQz4: true, divideByCos2ThetaSquared: true, fourierTransform: true }
  project.calculation.averaging = 1
  project.experiment.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
  const input: Dataset['columns'] = { qz: [.01, .03, .02, .04, .05],
    reflectivity: [1, 2, 3, 4, 5], reflectivityPlus: [2, 4, 6, 8, 10],
    reflectivityMinus: [1, 1, 1, 1, 1], asymmetry: [0, 0, 0, 0, 0],
    energy: [600, 610, 620, 630, 640], electronYield: [5, 4, 3, 2, 1] }
  const original = structuredClone(input)
  const beforeFourier = postprocessDatasetColumns({ ...project, calculation: { ...project.calculation,
    postProcessing: { ...project.calculation.postProcessing, fourierTransform: false } } }, input)
  const depths = new Float64Array([0, 125.66384]), magnitudes = new Float64Array([0, .002])
  let calls = 0
  const result = postprocessDatasetColumns(project, input, true, (qz, reflectivity) => {
    calls++
    expect(qz).toEqual(input.qz) // unordered coordinates are preserved
    expect(reflectivity).toEqual(beforeFourier.reflectivity)
    expect(reflectivity[0]).toBe(0) // legacy leading moving-average window
    qz[0] = 99; reflectivity[0] = 99
    return { depths, magnitudes }
  })
  expect(calls).toBe(1)
  expect(result).toEqual({ ...beforeFourier, qz: [0, 125.66384], reflectivity: [0, .002] })
  depths[0] = 99; magnitudes[0] = 99
  expect(result.qz[0]).toBe(0)
  expect(result.reflectivity![0]).toBe(0)
  expect(input).toEqual(original)
})

it('preserves the legacy no-op for absent or empty ordinary reflectivity', () => {
  const project = createDefaultProject()
  project.calculation.postProcessing.fourierTransform = true
  for (const reflectivity of [undefined, []]) {
    const input = { qz: [.1, .2], reflectivity, reflectivityPlus: [2, 3], reflectivityMinus: [1, 1] }
    const result = postprocessDatasetColumns(project, input, true, () => { throw new Error('Unexpected FFT') })
    expect(result).toEqual(input)
  }
})

it('rejects missing capability, invalid native results and native failures without input mutation', () => {
  const project = createDefaultProject()
  project.calculation.postProcessing.fourierTransform = true
  const input = { qz: [.1, .2], reflectivity: [1, 2] }
  const original = structuredClone(input)
  expect(() => postprocessDatasetColumns(project, input)).toThrow('Fourier')
  for (const result of [
    { depths: new Float64Array(), magnitudes: new Float64Array([0]) },
    { depths: new Float64Array([0]), magnitudes: new Float64Array([NaN]) },
    { depths: new Float64Array([Infinity]), magnitudes: new Float64Array([0]) },
  ]) expect(() => postprocessDatasetColumns(project, input, true, () => result)).toThrow('invalid Fourier')
  expect(() => postprocessDatasetColumns(project, input, true, () => { throw new Error('Native failure') })).toThrow('Native failure')
  expect(input).toEqual(original)
})
