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
