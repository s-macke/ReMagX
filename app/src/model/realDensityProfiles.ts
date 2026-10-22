import type { DensityProfiles } from '../compute/ComputeService'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealBeforeCalculation, RealCalculationEngine } from './realCalculation'
import { prepareProjectOptics } from './projectOptics'

// Unit1.cpp ShowDensityProfilesClick: GetState, temporary BeforeCalculation,
// then DrawDensityProfiles. Unlike optical profiles, there is no SetOCStrict.
export function realDensityProfiles(original: Project, tables: OpticalTable[], engine: RealCalculationEngine,
  hook?: RealBeforeCalculation, maximumSamples = 1000000): DensityProfiles {
  let { project, opticalState } = prepareProjectOptics(original, tables, engine)
  if (project.scripts.enabled && project.scripts.beforeCalculation.trim()) {
    if (!hook) throw new Error('Density profiles require BeforeCalculation execution.')
    const result = hook(project, opticalState, 0, 'temporary')
    project = result.project
  }
  const preparation = engine.elementPreparation
  if (!preparation || preparation.errorSamples.length !== 1001 || !Array.from(preparation.errorSamples).every(Number.isFinite)) {
    throw new Error('Element density profiles require an explicit error-function lookup and numerical engine.')
  }
  if (project.sample.mode !== 'element' || !project.sample.elementProfiles.length) throw new Error('Define elements to show their density profiles.')
  const step = project.calculation.segmentation.minThickness
  if (!Number.isFinite(step) || step <= 0 || !Number.isSafeInteger(maximumSamples) || maximumSamples < 1) {
    throw new Error('Invalid density-profile sampling settings.')
  }
  let totalThickness = 0, terminalRoughness = 0
  const stacks = project.sample.elementProfiles.map(profile => {
    if (!profile.slabs.length) throw new Error('Element density profiles require slabs.')
    let thickness = 0
    const boundaries: number[] = []
    const slabs = profile.slabs.map((slab, index) => {
      if (![slab.thickness, slab.roughness, slab.density].every(Number.isFinite) || slab.thickness < 0 || slab.roughness < 0) {
        throw new Error('Invalid element density slab.')
      }
      if (index > 0) {
        boundaries.push(thickness)
        if (index < profile.slabs.length - 1) thickness += slab.thickness
      }
      return [slab.thickness, slab.roughness, slab.density]
    })
    // Strictly greater: equal-height profiles do not replace the first winner.
    if (thickness > totalThickness) {
      totalThickness = thickness; terminalRoughness = profile.slabs.at(-2)!.roughness
    }
    return { name: profile.element, slabs, boundaries }
  })
  if (totalThickness === 0) throw new Error('The legacy density-profile range is undefined without a positive interior thickness.')
  const maximumDepth = totalThickness + 30 + terminalRoughness * 2
  if (!Number.isFinite(maximumDepth)) throw new Error('Density-profile depth range overflow.')
  const z: number[] = []
  for (let depth = -30; depth < maximumDepth;) {
    if (z.length >= maximumSamples) throw new Error('Density-profile sampling exceeds the supported limit.')
    z.push(depth)
    const next = depth + step
    if (next <= depth) throw new Error('Density-profile depth grid does not advance.')
    depth = next
  }
  const elements = stacks.map(({ name, slabs, boundaries }) => {
    const positions = [...z, ...boundaries]
    const values = preparation.density({ slabs, positions, errorSamples: Array.from(preparation.errorSamples) })
    if (values.length !== positions.length || !values.every(Number.isFinite)) throw new Error('Invalid native density-profile result.')
    return { name, density: Array.from(values.slice(0, z.length)),
      boundaries: boundaries.map((depth, index) => ({ z: depth, density: values[z.length + index] })) }
  })
  return { engine: 'real', z, elements }
}
