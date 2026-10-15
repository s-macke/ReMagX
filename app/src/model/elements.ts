// Element mode: editing the slab stacks of the element profiles. As with layers, slabs[0] is the
// substrate and the last slab the ambient medium (legacy ElementLayerSystem::GetDensity).

import type { ElementProfile, Project } from './project'

type Slab = ElementProfile['slabs'][number]

function withElement(project: Project, elementIndex: number, update: (element: ElementProfile) => ElementProfile): Project {
  const elementProfiles = project.sample.elementProfiles.map((e, i) => (i === elementIndex ? update(e) : e))
  return { ...project, sample: { ...project.sample, elementProfiles } }
}

export function updateElement(project: Project, elementIndex: number, patch: Partial<Omit<ElementProfile, 'slabs'>>): Project {
  return withElement(project, elementIndex, (e) => ({ ...e, ...patch }))
}

export function updateSlab(project: Project, elementIndex: number, slabIndex: number, patch: Partial<Slab>): Project {
  return withElement(project, elementIndex, (e) => ({ ...e, slabs: e.slabs.map((s, i) => (i === slabIndex ? { ...s, ...patch } : s)) }))
}

export function insertSlabAbove(project: Project, elementIndex: number, slabIndex: number): { project: Project; inserted: number } {
  const element = project.sample.elementProfiles[elementIndex]
  if (!element) return { project, inserted: slabIndex }
  const slabs = [...element.slabs]
  const last = slabs.length - 1
  const source = slabIndex >= last ? last - 1 : slabIndex
  const position = Math.max(1, source + 1)
  slabs.splice(position, 0, source >= 1 ? { ...slabs[source] } : { thickness: 10, density: 0, roughness: 0 })
  return { project: withElement(project, elementIndex, (e) => ({ ...e, slabs })), inserted: position }
}

export function canRemoveSlab(project: Project, elementIndex: number, slabIndex: number): boolean {
  const slabs = project.sample.elementProfiles[elementIndex]?.slabs ?? []
  return slabIndex > 0 && slabIndex < slabs.length - 1
}

export function removeSlab(project: Project, elementIndex: number, slabIndex: number): Project {
  if (!canRemoveSlab(project, elementIndex, slabIndex)) return project
  return withElement(project, elementIndex, (e) => ({ ...e, slabs: e.slabs.filter((_, i) => i !== slabIndex) }))
}
