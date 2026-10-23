import { expect, it } from 'vitest'
import { createDefaultProject, createDepthProfileFunction, createLayer } from './defaults'
import type { Dataset, FitParameter, FitTargetKind } from './project'
import { applyRealFitParameters } from './realFitParameters'

const parameter = (target: FitTargetKind, index: number | null = null, elementIndex: number | null = null): FitParameter =>
  ({ target, index, elementIndex, value: 0, step: 0, lowerBound: -1000, upperBound: 1000 })
function fixture() {
  const project = createDefaultProject()
  const dataset: Dataset = { title: '', comment: '', sourceFile: '', energy: 640, energyShift: 1, qzShift: 2,
    angularResolution: .002, intensityScale: 3, intensityOffset: 4, active: true, errorWeight: 5,
    polarization: project.experiment.polarization, columns: { qz: [.01, .02], reflectivity: [1, 2] } }
  project.datasets = [structuredClone(dataset), structuredClone(dataset), { ...structuredClone(dataset), active: false }]
  project.activeDatasetIndex = 2
  project.sample.layers = [createLayer(), createLayer(), createLayer()]
  return project
}
it('applies dataset-wide parameters only to enabled datasets, regardless of the current selection', () => {
  const project = fixture()
  project.fit.parameters = [parameter('angularResolution'), parameter('intensityScale')]
  const before = structuredClone(project)
  const result = applyRealFitParameters(project, [.004, 7])
  expect(result.project.experiment.resolution.angularFwhm).toBe(.004)
  expect(result.project.datasets.map(dataset => dataset.angularResolution)).toEqual([.004, .004, .002])
  expect(result.project.datasets.map(dataset => dataset.intensityScale)).toEqual([7, 7, 3])
  expect(result.project.datasets.map(dataset => dataset.intensityOffset)).toEqual([4, 4, 4])
  expect(result.project.fit.parameters.map(row => row.value)).toEqual([.004, 7])
  expect(result.project.activeDatasetIndex).toBe(2)
  expect(project).toEqual(before)
  expect(result.project.datasets[0].columns).toBe(project.datasets[0].columns)
})
it('maps coordinate shifts to the supplied current dataset even when it is inactive', () => {
  const project = fixture()
  project.fit.parameters = [parameter('qzShift'), parameter('energyShift')]
  const result = applyRealFitParameters(project, [.01, -3]).project
  expect(result.datasets.map(dataset => [dataset.qzShift, dataset.energyShift])).toEqual([[2, 1], [2, 1], [.01, -3]])
  project.activeDatasetIndex = 0
  expect(applyRealFitParameters(project, [.02, 4]).project.datasets.map(dataset => dataset.qzShift)).toEqual([.02, 2, 2])
  project.activeDatasetIndex = null
  expect(() => applyRealFitParameters(project, [.01, 3])).toThrow('supported target')
})
it('maps compound, profile and script values without treating a zero step as inactive', () => {
  const project = fixture()
  project.sample.depthProfileFunctions = [createDepthProfileFunction()]
  project.scripts.parameters = [1, 2]
  const targets = ['thickness', 'delta', 'beta', 'roughness', 'deltaMag', 'betaMag', 'magnetizationGamma', 'magnetizationPhi', 'electronEscapeDepth'] as const
  project.fit.parameters = [...targets.map(target => parameter(target, 1)), parameter('profileDeltaAmplitude', 0),
    parameter('profileBetaAmplitude', 0), parameter('profileWidth', 0), parameter('profileCenter', 0), parameter('scriptParameter', 1)]
  const values = project.fit.parameters.map((_, index) => index + 1)
  const result = applyRealFitParameters(project, values).project
  expect(result.sample.layers[1]).toMatchObject({ thickness: 1, delta: 2, beta: 3, roughness: 4, deltaMag: 5, betaMag: 6,
    magnetization: { gamma: 7, phi: 8 }, electronEscapeDepth: 9 })
  expect(result.sample.depthProfileFunctions[0]).toMatchObject({ deltaAmplitude: 10, betaAmplitude: 11, width: 12, center: 13 })
  expect(result.scripts.parameters).toEqual([1, 14])
  expect(result.fit.parameters.every(row => row.step === 0)).toBe(true)
})
it('maps element/slab fields by both indices without changing neighboring profiles', () => {
  const project = fixture()
  const element = { element: 'Fe', f1: 1, f2: 2, f1Mag: 3, f2Mag: 4,
    slabs: [{ thickness: 0, density: 0, roughness: 0 }, { thickness: 10, density: 2, roughness: 1 }] }
  project.sample.elementProfiles = [structuredClone(element), structuredClone(element)]
  project.sample.mode = 'element'
  project.fit.parameters = ['elementDensity', 'elementThickness', 'elementRoughness', 'elementF1', 'elementF2', 'elementF1Mag', 'elementF2Mag']
    .map(target => parameter(target as FitTargetKind, 1, 1))
  const result = applyRealFitParameters(project, [5, 6, 7, 8, 9, 10, 11]).project
  expect(result.sample.elementProfiles[0]).toEqual(element)
  expect(result.sample.elementProfiles[1]).toMatchObject({ f1: 8, f2: 9, f1Mag: 10, f2Mag: 11,
    slabs: [{ thickness: 0, density: 0, roughness: 0 }, { thickness: 6, density: 5, roughness: 7 }] })
  expect(project.sample.elementProfiles[1]).toEqual(element)
})
it('clips to bounds, keeps fixed rows and preserves list-order writes for duplicate targets', () => {
  const project = fixture()
  project.fit.parameters = [parameter('thickness', 1), parameter('thickness', 1), parameter('beta', 1)]
  project.fit.parameters[0].lowerBound = 0; project.fit.parameters[0].upperBound = 10
  project.fit.parameters[1].lowerBound = 4; project.fit.parameters[1].upperBound = 4
  const result = applyRealFitParameters(project, [-2, 999, 2000])
  expect(result.values).toEqual([0, 4, 1000])
  expect(result.project.sample.layers[1]).toMatchObject({ thickness: 4, beta: 1000 })
  expect(result.project.fit.parameters.map(row => row.value)).toEqual(result.values)
})
it('retains signed zero at equal bounds and accepts native callback vectors', () => {
  const project = fixture()
  project.fit.parameters = [{ ...parameter('delta', 1), lowerBound: 0, upperBound: 1 }]
  const result = applyRealFitParameters(project, new Float64Array([-0]))
  expect(Object.is(result.values[0], -0)).toBe(true)
  expect(Object.is(result.project.sample.layers[1].delta, -0)).toBe(true)
})
it('rejects invalid candidates/bounds and missing targets atomically', () => {
  const project = fixture()
  project.fit.parameters = [parameter('thickness', 1), parameter('electronGain', 1)]
  const before = structuredClone(project)
  expect(() => applyRealFitParameters(project, [20, 2])).toThrow('supported target')
  expect(project).toEqual(before)
  expect(() => applyRealFitParameters(project, [1])).toThrow('counts')
  expect(() => applyRealFitParameters(project, [NaN, 2])).toThrow('Invalid')
  project.fit.parameters[1] = { ...parameter('beta', 1), lowerBound: 2, upperBound: 1 }
  expect(() => applyRealFitParameters(project, [1, 2])).toThrow('bounds')
  project.fit.parameters = [parameter('thickness', 100)]
  expect(() => applyRealFitParameters(project, [1])).toThrow('supported target')
})

it('retains missing script fit rows while skipping only their unavailable assignments', () => {
  const project = fixture()
  project.scripts.parameters = [3]
  project.fit.parameters = [parameter('scriptParameter', null), parameter('scriptParameter', -1),
    parameter('scriptParameter', 1), parameter('scriptParameter', 20),
    parameter('scriptParameter', 0), parameter('thickness', 1)]
  const before = structuredClone(project)
  const result = applyRealFitParameters(project, [-2000, 2, 4, 5, 6, 7])
  expect(result.values).toEqual([-1000, 2, 4, 5, 6, 7])
  expect(result.project.fit.parameters.map(row => row.value)).toEqual(result.values)
  expect(result.project.fit.parameters.map(row => row.index)).toEqual([null, -1, 1, 20, 0, 1])
  expect(result.project.scripts.parameters).toEqual([6])
  expect(result.project.sample.layers[1].thickness).toBe(7)
  expect(project).toEqual(before)
  // A later candidate uses the current script array, without dropping old rows.
  result.project.scripts.parameters.push(0)
  const next = applyRealFitParameters(result.project, result.values)
  expect(next.project.scripts.parameters).toEqual([6, 4])
  project.scripts.parameters = []
  expect(applyRealFitParameters(project, [1, 2, 3, 4, 5, 6]).project.scripts.parameters).toEqual([])
})
