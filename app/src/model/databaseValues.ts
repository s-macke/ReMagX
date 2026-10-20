import type { Project } from './project'

export interface DatabaseValues {
  mode: 'compound' | 'element'
  engine?: 'real'
  updates: { index: number; first: number; second: number; firstMag: number; secondMag: number; dielectricTensor?: Project['sample']['layers'][number]['dielectricTensor']; scatteringTensor?: number[] }[]
  inactiveTensorUpdates?: { index: number; dielectricTensor?: Project['sample']['layers'][number]['dielectricTensor']; scatteringTensor?: number[] }[]
  warnings: string[]
}

// Scalar fields and supplied stored tensors are written together. The reducer verifies that the
// source project and table library still match before calling this function.
export function applyDatabaseValues(project: Project, result: DatabaseValues): Project {
  if (result.mode !== project.sample.mode || (result.updates.length === 0 && !result.inactiveTensorUpdates?.length)) return project
  const updates = new Map(result.updates.map(update => [update.index, update]))
  const inactive = new Map(result.inactiveTensorUpdates?.map(update => [update.index, update]))
  return { ...project, sample: result.mode === 'compound' ? { ...project.sample,
    elementProfiles: project.sample.elementProfiles.map((element, index) => {
      const tensor = inactive.get(index)?.scatteringTensor
      return tensor ? { ...element, scatteringTensor: tensor.slice() } : element
    }),
    layers: project.sample.layers.map((layer, index) => {
      const update = updates.get(index)
      return update ? { ...layer, delta: update.first, beta: update.second, deltaMag: update.firstMag, betaMag: update.secondMag,
        ...(update.dielectricTensor ? { dielectricTensor: structuredClone(update.dielectricTensor) } : {}) } : layer
    }),
  } : { ...project.sample, layers: project.sample.layers.map((layer, index) => {
    const tensor = inactive.get(index)?.dielectricTensor
    return tensor ? { ...layer, dielectricTensor: structuredClone(tensor) } : layer
  }), elementProfiles: project.sample.elementProfiles.map((element, index) => {
    const update = updates.get(index)
    return update ? { ...element, f1: update.first, f2: update.second, f1Mag: update.firstMag, f2Mag: update.secondMag,
      ...(update.scatteringTensor ? { scatteringTensor: update.scatteringTensor.slice() } : {}) } : element
  }) } }
}
