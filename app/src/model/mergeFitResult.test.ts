import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { createFitParameter } from './fitTargets'
import { mergeFitResult } from './mergeFitResult'
import type { FitResult } from '../compute/ComputeService'

function fixture() {
  const source = createDefaultProject()
  source.datasets = Array.from({ length: 3 }, (_, index) => ({ title: `data ${index}`, comment: '', sourceFile: '',
    energy: 640, energyShift: 0, qzShift: 0, angularResolution: 0, intensityScale: 1, intensityOffset: 0,
    active: index < 2, errorWeight: 1, polarization: source.experiment.polarization,
    columns: { qz: [.02], reflectivity: [1] } }))
  source.activeDatasetIndex = 2
  source.fit.parameters = [createFitParameter(source, 'thickness', 1, null),
    createFitParameter(source, 'intensityScale', null, null), createFitParameter(source, 'angularResolution', null, null),
    createFitParameter(source, 'qzShift', null, null)]
  const current = { ...source, sample: structuredClone(source.sample), experiment: structuredClone(source.experiment),
    datasets: source.datasets.map(data => ({ ...data })), fit: structuredClone(source.fit) }
  const result: FitResult = { project: structuredClone(source), values: [35, 2, .01, .003], chi2: 0,
    iterations: 20, stopped: false, datasetUpdates: [
      { index: 0, values: { intensityScale: 2, angularResolution: .01 } },
      { index: 1, values: { intensityScale: 2, angularResolution: .01, qzShift: .003 } },
      { index: 2, values: { qzShift: 0 } },
    ] }
  return { source, current, result }
}

it('merges only fitted fields, including real dataset-wide values and historical shift targets', () => {
  const { source, current, result } = fixture()
  current.datasets[0].comment = 'edited'; current.datasets[0].active = false
  current.datasets[1].energy = 700; current.datasets[1].errorWeight = 9
  current.datasets[2].intensityScale = 7; current.datasets[2].qzShift = .8
  current.sample.layers[2].roughness = 6
  current.fit.parameters[0].upperBound = 1000
  result.project.activeDatasetIndex = 1
  result.project.experiment.energy = 800
  result.project.sample.layers[0].delta = 999 // incidental table refresh must not be merged
  const before = structuredClone(current)
  const merged = mergeFitResult(current, source, result)
  expect(merged.sample.layers[1].thickness).toBe(35)
  expect(merged.sample.layers[2].roughness).toBe(6)
  expect(merged.sample.layers[0].delta).toBe(current.sample.layers[0].delta)
  expect(merged.experiment.energy).toBe(current.experiment.energy)
  expect(merged.experiment.resolution.angularFwhm).toBe(.01)
  expect(merged.activeDatasetIndex).toBe(2)
  expect(merged.datasets.map(data => data.intensityScale)).toEqual([2, 2, 7])
  expect(merged.datasets.map(data => data.qzShift)).toEqual([0, .003, 0])
  expect(merged.datasets[0]).toMatchObject({ comment: 'edited', active: false })
  expect(merged.datasets[1]).toMatchObject({ energy: 700, errorWeight: 9 })
  expect(merged.fit.parameters.map(parameter => parameter.value)).toEqual(result.values)
  expect(merged.fit.parameters[0].upperBound).toBe(1000)
  expect(merged.datasets[0].columns).toBe(current.datasets[0].columns)
  expect(current).toEqual(before)
})

it('preserves mock active-dataset behavior and rejects stale structural results', () => {
  const { source, current, result } = fixture()
  delete result.datasetUpdates
  const merged = mergeFitResult(current, source, result)
  expect(merged.datasets.map(data => data.intensityScale)).toEqual([1, 1, 2])
  expect(merged.datasets.map(data => data.qzShift)).toEqual([0, 0, .003])
  current.datasets.reverse()
  expect(mergeFitResult(current, source, result)).toBe(current)
})

it('updates duplicate start-value rows in order and fails atomically for malformed results', () => {
  const { source, current, result } = fixture()
  source.fit.parameters = [source.fit.parameters[0], { ...source.fit.parameters[0] }]
  current.fit.parameters = structuredClone(source.fit.parameters)
  result.values = [34, 35]; result.datasetUpdates = []
  expect(mergeFitResult(current, source, result).fit.parameters.map(parameter => parameter.value)).toEqual([34, 35])
  expect(mergeFitResult(current, source, result).sample.layers[1].thickness).toBe(35)
  const before = structuredClone(current)
  result.datasetUpdates = [{ index: 999, values: { qzShift: .1 } }]
  expect(() => mergeFitResult(current, source, result)).toThrow('index')
  result.datasetUpdates = [{ index: 0, values: { qzShift: NaN } }]
  expect(() => mergeFitResult(current, source, result)).toThrow('value')
  result.values = [1]
  expect(() => mergeFitResult(current, source, result)).toThrow('parameter')
  expect(current).toEqual(before)
})
