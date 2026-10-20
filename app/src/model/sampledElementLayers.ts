import type { Project } from './project'
import { prepareElementLayers, type ElementOpticsCalculator } from './elementLayers'

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
  const slabs = new Map(project.sample.elementProfiles.map(profile => [profile,
    profile.slabs.map(slab => [slab.thickness, slab.roughness, slab.density])]))
  return prepareElementLayers(project, (profile, depth) => {
    const rows = slabs.get(profile)
    if (!rows) throw new Error('Element density profile was not prepared.')
    const values = engine.density({ slabs: rows.map(row => row.slice()), positions: [depth], errorSamples: samples.slice() })
    if (values.length !== 1 || !Number.isFinite(values[0])) throw new Error('Invalid native element density result.')
    return values[0]
  }, engine.optics, scatteringTensors, maximumSamples)
}
