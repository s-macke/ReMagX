// Layer-stack editing. layers[0] is the substrate ("bulk"), the last entry the ambient medium
// ("air"); both always exist. All functions return a new project and leave the input unchanged.

import { createLayer } from './defaults'
import { remapProfileBindings } from './magneticProfiles'
import type { Layer, Project } from './project'

export const isSubstrate = (index: number) => index === 0
export const isAmbient = (project: Project, index: number) => index === project.sample.layers.length - 1

function withLayers(project: Project, layers: Layer[]): Project {
  return { ...project, sample: { ...project.sample, layers } }
}

export function updateLayer(project: Project, index: number, patch: Partial<Layer>): Project {
  const layers = project.sample.layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer))
  return withLayers(project, layers)
}

// Inserts a copy of the layer at `index` directly above it (above the substrate if the ambient
// medium is selected, since nothing can sit above the ambient).
export function insertLayerAbove(project: Project, index: number): { project: Project; inserted: number } {
  const layers = [...project.sample.layers]
  const source = isAmbient(project, index) ? layers.length - 2 : index
  const template = source <= 0 ? createLayer({ thickness: 10 }) : { ...layers[source] }
  const position = Math.max(1, source + 1)
  layers.splice(position, 0, structuredClone(template))
  const changed = withLayers(project, layers)
  changed.sample.depthProfileFunctions = remapProfileBindings(project, layers.length, index => index >= position ? index + 1 : index)
  return { project: changed, inserted: position }
}

export function canRemoveLayer(project: Project, index: number): boolean {
  return !isSubstrate(index) && !isAmbient(project, index)
}

export function removeLayer(project: Project, index: number): Project {
  if (!canRemoveLayer(project, index)) return project
  const layers = project.sample.layers.filter((_, i) => i !== index)
  const changed = withLayers(project, layers)
  changed.sample.depthProfileFunctions = remapProfileBindings(project, layers.length, oldIndex => oldIndex === index ? null : oldIndex > index ? oldIndex - 1 : oldIndex)
  return changed
}

// Legacy "Apply to all layers" of the Magneto-Optics frame.
export function applyMagnetizationToAllLayers(project: Project, direction: Layer['magnetization']): Project {
  return withLayers(
    project,
    project.sample.layers.map((layer) => ({ ...layer, magnetization: { ...direction } })),
  )
}
