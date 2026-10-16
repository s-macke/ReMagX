import { fitTargetInfo } from './fitTargets'
import type { Project } from './project'

// Deleting a profile must not silently redirect its fit targets or coupling references
// to the next profile. Preserve the identity of all surviving references.
export function removeMagneticProfile(project: Project, index: number): Project {
  if (!Number.isInteger(index) || index < 0 || index >= project.sample.depthProfileFunctions.length) return project
  const remap = (value: number | null) => value === null || value === index ? null : value > index ? value - 1 : value
  return {
    ...project,
    sample: { ...project.sample, depthProfileFunctions: project.sample.depthProfileFunctions
      .filter((_, i) => i !== index)
      .map(profile => ({ ...profile, amplitudeCoupledTo: remap(profile.amplitudeCoupledTo), widthCoupledTo: remap(profile.widthCoupledTo) })) },
    fit: { ...project.fit, parameters: project.fit.parameters
      .filter(parameter => fitTargetInfo[parameter.target].index !== 'profileFunction' || parameter.index !== index)
      .map(parameter => fitTargetInfo[parameter.target].index === 'profileFunction' ? { ...parameter, index: remap(parameter.index) } : parameter) },
  }
}

// Legacy Button7Click calls CGaussFunc::BuildSpline(4): nine points, with
// two boundary points on either side excluded from the editable table.
export function buildProfileSpline(profile: Project['sample']['depthProfileFunctions'][number]) {
  const points = Array.from({ length: 9 }, (_, index) => {
    const z = profile.center + (index - 4) * 1.5 * profile.width
    const value = profile.width === 0 || profile.deltaAmplitude === 0
      ? 0 : Math.exp(-((z - profile.center) ** 2) / 2 / (profile.width ** 2))
    if (!Number.isFinite(z) || !Number.isFinite(value)) throw new Error('The profile center or width is too large to build a spline.')
    return { z, value }
  })
  return { ...profile, spline: { enabled: true, points } }
}

// The saved binding retains legacy indexing: null = all, 0 = air,
// layerCount - 1 = bulk, layerCount = none. This is not a layers[] index.
export function profileBindingOptions(layerCount: number) {
  return [
    { value: '', label: 'all' },
    ...Array.from({ length: layerCount }, (_, binding) => ({
      value: String(binding),
      label: binding === 0 ? 'air' : binding === layerCount - 1 ? 'bulk' : `layer ${layerCount - binding - 1}`,
    })),
    { value: String(layerCount), label: 'none' },
  ]
}

export function remapProfileBindings(project: Project, newLayerCount: number, mapLayer: (index: number) => number | null) {
  const oldLayerCount = project.sample.layers.length
  return project.sample.depthProfileFunctions.map(profile => {
    const binding = profile.boundToLayer
    if (binding === null || binding > oldLayerCount) return profile
    const layer = binding === oldLayerCount ? null : mapLayer(oldLayerCount - binding - 1)
    return { ...profile, boundToLayer: layer === null ? newLayerCount : newLayerCount - layer - 1 }
  })
}
