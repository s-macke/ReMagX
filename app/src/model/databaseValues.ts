import type { Project } from './project'

export interface DatabaseValues {
  mode: 'compound' | 'element'
  updates: { index: number; first: number; second: number; firstMag: number; secondMag: number }[]
  warnings: string[]
}

// Only table-derived scalar fields are written. The reducer verifies that the
// source project and table library still match before calling this function.
export function applyDatabaseValues(project: Project, result: DatabaseValues): Project {
  if (result.mode !== project.sample.mode || result.updates.length === 0) return project
  const updates = new Map(result.updates.map(update => [update.index, update]))
  return { ...project, sample: result.mode === 'compound' ? { ...project.sample,
    layers: project.sample.layers.map((layer, index) => {
      const update = updates.get(index)
      return update ? { ...layer, delta: update.first, beta: update.second, deltaMag: update.firstMag, betaMag: update.secondMag } : layer
    }),
  } : { ...project.sample, elementProfiles: project.sample.elementProfiles.map((element, index) => {
    const update = updates.get(index)
    return update ? { ...element, f1: update.first, f2: update.second, f1Mag: update.firstMag, f2Mag: update.secondMag } : element
  }) } }
}
