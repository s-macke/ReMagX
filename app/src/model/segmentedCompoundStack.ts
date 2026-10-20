import { packCompoundLayers, prepareCompoundLayerIndices } from './compoundLayers'
import { applySegmentedMagneticProfiles, type MagneticProfileEngine } from './segmentedMagneticProfiles'
import { prepareSegmentedLayers, type SegmentationEngine, type SegmentationTensor } from './segmentedLayers'
import type { Project } from './project'

// FillLayers copies stored z independently of d. ExecuteMultilayer repeats both;
// Lua thickness writes update d alone. Never reconstruct z from post-hook d here.
// Tensor state must likewise have been prepared before this stage.
export function prepareSegmentedCompoundStack(project: Project, storedDepths: readonly number[],
  errorSamples: readonly number[], engine: SegmentationEngine & MagneticProfileEngine,
  storedTensors?: readonly SegmentationTensor[]) {
  if (project.sample.mode !== 'compound' || project.calculation.roughnessModel !== 'segmentation') {
    throw new Error('Segmented compound preparation requires compound mode and segmentation.')
  }
  const count = project.sample.layers.length
  if (storedDepths.length !== count || !Array.from(storedDepths).every(Number.isFinite)) {
    throw new Error('Stored layer depths must match the original compound stack.')
  }
  const matrix = project.calculation.algorithm === 'matrix'
  if (matrix && (!storedTensors || storedTensors.length !== count || !Array.from(storedTensors).every(tensor =>
    tensor && tensor.values.length === 18 && Array.from(tensor.values).every(Number.isFinite) && typeof tensor.anisotropic === 'boolean'))) {
    throw new Error('Stored dielectric tensors must match the original compound stack.')
  }
  const indices = prepareCompoundLayerIndices(project)
  const layers = packCompoundLayers(project)
  const result = prepareSegmentedLayers(layers, project.calculation.segmentation, errorSamples, engine,
    matrix ? indices.map(index => storedTensors![index]) : undefined)
  if (project.calculation.magnetization.mode === 'profile') {
    result.layers = applySegmentedMagneticProfiles(result.layers, result.positions,
      indices.map(index => storedDepths[index]), layers.map(layer => layer[1]), project.sample.depthProfileFunctions,
      project.calculation.profileCombination === 'sum', errorSamples, engine)
  }
  return result
}
