import type { Project } from './project'
import type { PreparedCompoundLayer } from './compoundLayers'
import { HC_EV_ANGSTROM } from './units'

export interface PreparedElementOptics {
  elements: [number, number, number, number, number][]
  factor: number
  scatteringTensors: number[][] | null
}
export type ElementOpticsCalculator = (request: PreparedElementOptics) => {
  opticalConstants: Float64Array
  dielectricTensor: Float64Array | null
}
export type ElementDensitySampler = (profile: Project['sample']['elementProfiles'][number], depth: number) => number

// Element2Material orchestration, independent of the unresolved erfftable sampler.
// Call after table refresh and BeforeCalculation. No fallback density approximation.
export function prepareElementLayers(project: Project, sampleDensity: ElementDensitySampler,
  calculate: ElementOpticsCalculator, scatteringTensors: readonly Float64Array[] = [], maximumSamples = 1000000) {
  if (project.sample.mode !== 'element') throw new Error('Element layer preparation requires element mode.')
  const { minThickness: step, tolerance } = project.calculation.segmentation
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(tolerance) || tolerance < 0 ||
      !Number.isSafeInteger(maximumSamples) || maximumSamples < 1) throw new Error('Invalid element sampling settings.')
  const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy)
  const factor = (.0004151761541 * 1e6) / (energy * energy)
  if (!Number.isFinite(energy) || energy <= 0 || !Number.isFinite(factor)) throw new Error('Invalid element calculation energy.')
  const profiles = project.sample.elementProfiles
  const matrix = project.calculation.algorithm === 'matrix'
  if (matrix && (scatteringTensors.length !== profiles.length ||
      Array.from(scatteringTensors).some(tensor => !tensor || tensor.length !== 18 || !tensor.every(Number.isFinite)))) {
    throw new Error('Element scattering tensors must match the profiles.')
  }
  const { gamma, phi } = project.calculation.magnetization.direction
  if (!Number.isFinite(gamma) || !Number.isFinite(phi)) throw new Error('Invalid element magnetization direction.')
  let totalThickness = 0, terminalRoughness = 0
  for (const profile of profiles) {
    if (![profile.f1, profile.f2, profile.f1Mag, profile.f2Mag].every(Number.isFinite)) throw new Error('Invalid element factors.')
    let thickness = 0
    profile.slabs.forEach((slab, index) => {
      if (![slab.thickness, slab.roughness, slab.density].every(Number.isFinite) || slab.thickness < 0 || slab.roughness < 0) {
        throw new Error('Invalid element slab.')
      }
      if (index > 0 && index < profile.slabs.length - 1) thickness += slab.thickness
    })
    // Legacy takes the penultimate roughness only when a new thickest profile wins.
    if (thickness > totalThickness) {
      totalThickness = thickness
      if (profile.slabs.length >= 2) terminalRoughness = profile.slabs.at(-2)!.roughness
    }
  }
  const maximumDepth = totalThickness + 30 + terminalRoughness * 2
  if (!Number.isFinite(maximumDepth)) throw new Error('Element depth range overflow.')
  const layers: PreparedCompoundLayer[] = []
  const positions: number[] = []
  const tensors: (Float64Array | null)[] = []
  let previous = [-1e99, -1e99, -1e99, -1e99]
  let samples = 0
  for (let depth = -30; depth <= maximumDepth;) {
    if (++samples > maximumSamples) throw new Error('Element sampling exceeds the supported limit.')
    const elements = profiles.map(profile => {
      const density = sampleDensity(profile, depth)
      if (!Number.isFinite(density)) throw new Error('Invalid sampled element density.')
      return [density, profile.f1, profile.f2, profile.f1Mag, profile.f2Mag] as PreparedElementOptics['elements'][number]
    })
    const result = calculate({ elements, factor, scatteringTensors: matrix ? scatteringTensors.map(value => Array.from(value)) : null })
    const scalar = result.opticalConstants
    if (scalar.length !== 4 || !scalar.every(Number.isFinite) ||
        (matrix && (!result.dielectricTensor || result.dielectricTensor.length !== 18 || !result.dielectricTensor.every(Number.isFinite)))) {
      throw new Error('Invalid converted element optics.')
    }
    if (scalar.some((value, index) => Math.abs(previous[index] - value) > tolerance)) {
      previous = Array.from(scalar)
      layers.push([0, 0, 0, 0, 0, 0, gamma, phi])
      positions.push(depth); tensors.push(null)
    }
    if (layers.length) {
      const index = layers.length - 1
      layers[index] = [0, 0, scalar[0], scalar[1], scalar[2], scalar[3], gamma, phi]
      positions[index] = depth
      tensors[index] = matrix ? result.dielectricTensor!.slice() : null
    }
    const next = depth + step
    if (next <= depth) throw new Error('Element depth grid does not advance.')
    depth = next
  }
  // ztod includes the final boundary; the first thickness remains its default zero.
  for (let index = 1; index < layers.length; index++) layers[index][0] = positions[index] - positions[index - 1]
  return { layers, positions, dielectricTensors: tensors, samples }
}
