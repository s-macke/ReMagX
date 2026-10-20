import type { Project } from './project'

// GetState/loader dtoz starts at substrate z=0 and adds each following d,
// including ambient thickness. Lua d writes do not repeat dtoz; fit candidate
// implementation explicitly rebuilds depths before its hooks.
export function copyLayerDepths(project: Project, previous?: readonly number[]): number[] {
  const count = project.sample.layers.length
  if (previous !== undefined) {
    if (previous.length !== count || !Array.from(previous).every(Number.isFinite)) {
      throw new Error('Stored layer depths must match the compound layer count.')
    }
    return Array.from(previous)
  }
  return rebuildLayerDepths(project)
}

export function rebuildLayerDepths(project: Project, substrateDepth = 0): number[] {
  let depth = substrateDepth
  return project.sample.layers.map((layer, index) => {
    if (index) depth += layer.thickness
    if (!Number.isFinite(depth)) throw new Error('Stored layer depth exceeds the numerical range.')
    return depth
  })
}
