import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { postprocessDatasetColumns } from './datasetPostprocessing'

it('rejects obsolete Fourier settings without modifying input columns', () => {
  const project = createDefaultProject()
  project.calculation.postProcessing.fourierTransform = true
  for (const reflectivity of [undefined, [], [1, 2]]) {
    const input = { qz: [.1, .2], reflectivity, reflectivityPlus: [2, 3], reflectivityMinus: [1, 1] }
    const before = structuredClone(input)
    expect(() => postprocessDatasetColumns(project, input)).toThrow('Fourier transformation is excluded')
    expect(input).toEqual(before)
  }
})

it('preserves coordinates and auxiliary columns during ordinary averaging', () => {
  const project = createDefaultProject(); project.calculation.averaging = 1
  const input = { qz: [.03, .01, .02], reflectivity: [2, 4, 6], energy: [600, 610, 620], electronYield: [5, 4, 3] }
  const before = structuredClone(input)
  const result = postprocessDatasetColumns(project, input)
  expect(result).toEqual({ ...input, reflectivity: [0, 4, 5] })
  expect(input).toEqual(before)
  expect(result.qz).not.toBe(input.qz)
})
