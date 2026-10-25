import type { PreparedCompoundLayer } from './compoundLayers'
import type { Project } from './project'

export interface MagneticProfileEngine {
  density(request: { boundaries: number[]; roughness: number[]; layerIndex: number;
    positions: number[]; errorSamples: number[] }): Float64Array
  apply(request: { profiles: number[][]; splines: ({ knots: number[]; values: number[] } | null)[];
    positions: number[]; initialValues: number[]; weights: number[][]; coupled: 0 | 1 }): Float64Array
}

// CalcMagProfile after segmentation. Boundaries belong to the original prepared
// stack; slice positions belong to the generated stack. Tensor state is untouched.
export function applySegmentedMagneticProfiles(
  layers: readonly PreparedCompoundLayer[], positions: readonly number[],
  boundaries: readonly number[], roughness: readonly number[],
  profiles: Project['sample']['depthProfileFunctions'], additive: boolean,
  errorSamples: readonly number[], engine: MagneticProfileEngine, storedLayerCount: number,
): PreparedCompoundLayer[] {
  const finite = (values: readonly number[], count: number) => values.length === count && Array.from(values).every(Number.isFinite)
  if (!Number.isSafeInteger(storedLayerCount) || storedLayerCount < 2 || layers.length < 1 || !finite(positions, layers.length) ||
      !Array.from(layers).every(row => row && finite(row, 8)) || boundaries.length < 2 ||
      !finite(boundaries, boundaries.length) || !finite(roughness, boundaries.length) ||
      roughness.some(value => value < 0) || !finite(errorSamples, 1001)) {
    throw new Error('Invalid segmented magnetic-profile input.')
  }
  const result = layers.map(row => row.slice() as PreparedCompoundLayer)
  // D-51: none refers to the stored table, not expanded or generated layers.
  const active = profiles.filter(profile => (profile.deltaAmplitude !== 0 || profile.betaAmplitude !== 0) &&
    profile.boundToLayer !== storedLayerCount)
  if (active.some(profile => profile.boundToLayer !== null &&
      (!Number.isSafeInteger(profile.boundToLayer) || profile.boundToLayer < 0 || profile.boundToLayer >= storedLayerCount))) {
    throw new Error('Magnetic-profile binding is outside the stored layer choices.')
  }
  if (layers.length === 1 || active.length === 0) return result
  const midpoints = positions.slice(1).map((value, index) => (value + positions[index]) * 0.5)
  if (!midpoints.every(Number.isFinite)) throw new Error('Magnetic-profile midpoint overflow.')
  const columns = active.map(profile => {
    if (profile.boundToLayer === null) return new Float64Array(midpoints.length).fill(1)
    const layerIndex = boundaries.length - profile.boundToLayer - 1
    if (!Number.isSafeInteger(layerIndex) || layerIndex < 0 || layerIndex >= boundaries.length) {
      throw new Error('Legacy magnetic-profile binding is outside the original layer stack.')
    }
    const weights = engine.density({ boundaries: Array.from(boundaries), roughness: Array.from(roughness),
      layerIndex, positions: midpoints.slice(), errorSamples: Array.from(errorSamples) })
    if (weights.length !== midpoints.length || !Array.from(weights).every(Number.isFinite)) {
      throw new Error('Invalid magnetic-profile density weights.')
    }
    return weights.slice()
  })
  const values = engine.apply({ profiles: active.map(profile => [profile.center, profile.width, profile.deltaAmplitude, profile.betaAmplitude]),
    splines: active.map(profile => profile.spline.enabled ? {
      knots: profile.spline.points.map(point => point.z), values: profile.spline.points.map(point => point.value),
    } : null), positions: midpoints, initialValues: result.slice(1).flatMap(row => [row[4], row[5]]),
    weights: midpoints.map((_, index) => columns.map(column => column[index])), coupled: additive ? 0 : 1 })
  if (values.length !== midpoints.length * 2 || !Array.from(values).every(Number.isFinite)) {
    throw new Error('Invalid magnetic-profile application output.')
  }
  for (let index = 1; index < result.length; ++index) {
    result[index][4] = values[(index - 1) * 2]
    result[index][5] = values[(index - 1) * 2 + 1]
  }
  return result
}
