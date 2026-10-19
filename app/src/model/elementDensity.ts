import type { Project } from './project'
import type { ElementDensitySampler } from './elementLayers'

type ElementProfile = Project['sample']['elementProfiles'][number]
/** Caller must supply the approved lookup; this module does not choose an erf approximation. */
export type ErrorFunctionLookup = (position: number) => number

// ElementLayerSystem::GetDensity, with prepared immutable slab boundaries.
export function createElementDensitySampler(profiles: readonly ElementProfile[], lookup: ErrorFunctionLookup): ElementDensitySampler {
  const prepared = new Map(profiles.map(profile => {
    let depth = 0
    const slabs = profile.slabs.map((slab, index) => {
      if (![slab.thickness, slab.roughness, slab.density].every(Number.isFinite) || slab.thickness < 0 || slab.roughness < 0) {
        throw new Error('Invalid element density slab.')
      }
      let start: number, end: number, leftRoughness: number, rightRoughness: number
      if (index === 0) {
        start = -1e10; end = depth; leftRoughness = 1e-5; rightRoughness = slab.roughness
      } else if (index === profile.slabs.length - 1) {
        start = depth; end = 1e10; leftRoughness = profile.slabs[index - 1].roughness; rightRoughness = 1e-5
      } else {
        start = depth; end = depth + slab.thickness
        leftRoughness = profile.slabs[index - 1].roughness; rightRoughness = slab.roughness
        depth += slab.thickness
      }
      if (!Number.isFinite(end)) throw new Error('Element density boundaries overflow.')
      return { start, end, leftRoughness: leftRoughness === 0 ? 1e-6 : leftRoughness,
        rightRoughness: rightRoughness === 0 ? 1e-6 : rightRoughness, density: slab.density }
    })
    return [profile, slabs] as const
  }))
  const scale = 1 / Math.sqrt(2)
  return (profile, depth) => {
    if (!Number.isFinite(depth)) throw new Error('Element density depth must be finite.')
    const slabs = prepared.get(profile)
    if (!slabs) throw new Error('Element density profile was not prepared.')
    let weightedDensity = 0, totalWeight = 0
    for (const slab of slabs) {
      // Retain the upper-then-lower lookup order and original arithmetic grouping.
      const upper = lookup((depth - slab.end) / slab.rightRoughness * scale)
      const lower = lookup((depth - slab.start) / slab.leftRoughness * scale)
      if (!Number.isFinite(upper) || !Number.isFinite(lower)) throw new Error('Invalid element error-function value.')
      const weight = .25 * ((1 - upper) * (1 + lower))
      weightedDensity += weight * slab.density
      totalWeight += weight
    }
    const density = weightedDensity / totalWeight
    if (!Number.isFinite(density)) throw new Error('Element density normalization is undefined.')
    return density
  }
}
