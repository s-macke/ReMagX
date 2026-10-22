import type { Project } from './project'
import { prepareElementSampling, convertSampledElementLayers, type ElementOpticsCalculator } from './elementLayers'

export interface ElementPreparationEngine {
  density(request: { slabs: number[][]; positions: number[]; errorSamples: number[] }): Float64Array
  optics: ElementOpticsCalculator
}

// Element2Material samples the current element slabs after Filldb/BeforeCalculation.
// This composes the numerical kernels without selecting a production erf policy.
export function prepareSampledElementLayers(project: Project, errorSamples: readonly number[],
  engine: ElementPreparationEngine, scatteringTensors: readonly Float64Array[] = [], maximumSamples = 1000000) {
  if (errorSamples.length !== 1001 || !Array.from(errorSamples).every(Number.isFinite)) {
    throw new Error('Element preparation requires 1001 finite error-function samples.')
  }
  const samples = Array.from(errorSamples)
  const prepared = prepareElementSampling(project, scatteringTensors, maximumSamples)
  const profiles = new Map(project.sample.elementProfiles.map(profile => [profile, {
    slabs: profile.slabs.map(slab => [slab.thickness, slab.roughness, slab.density]),
    start: -1, values: new Float64Array(0),
  }]))
  // Bound cached densities independently of the total depth-grid size. The
  // native batch kernel retains the same arithmetic for each supplied position.
  const batchSize = 256
  return convertSampledElementLayers(prepared, (profile, _depth, sampleIndex) => {
    const cached = profiles.get(profile)
    if (!cached) throw new Error('Element density profile was not prepared.')
    if (sampleIndex < cached.start || sampleIndex >= cached.start + cached.values.length) {
      const positions = prepared.depths.slice(sampleIndex, sampleIndex + batchSize)
      const count = positions.length
      const values = engine.density({ slabs: cached.slabs.map(row => row.slice()), positions, errorSamples: samples.slice() })
      if (values.length !== count || !values.every(Number.isFinite)) throw new Error('Invalid native element density result.')
      cached.start = sampleIndex
      cached.values = values.slice()
    }
    return cached.values[sampleIndex - cached.start]
  }, engine.optics)
}


export function prepareElementCalculationStack(project: Project, errorSamples: readonly number[],
  engine: ElementPreparationEngine, scatteringTensors?: readonly Float64Array[]) {
  const prepared = prepareSampledElementLayers(project, errorSamples, engine, scatteringTensors)
  // Element2oc marks every matrix layer anisotropic, including boundaries.
  return { layers: prepared.layers, dielectricTensors: prepared.dielectricTensors.map(values =>
    values ? { values, anisotropic: true } : null) }
}
