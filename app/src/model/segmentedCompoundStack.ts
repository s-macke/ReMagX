import { copyLayerDepths } from './layerDepths'
import type { SerialOpticalState } from './refreshOpticalConstants'
import type { RealCalculationEngine } from './realCalculation'
import { packCompoundLayers, prepareCompoundLayerIndices, type PreparedCompoundLayer } from './compoundLayers'
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
      project.calculation.profileCombination === 'sum', errorSamples, engine, count)
  }
  return result
}

export type PrepareSegmentedStack = (project: Project, state: SerialOpticalState) => { layers: PreparedCompoundLayer[]; dielectricTensors: (SegmentationTensor | null)[] } | undefined

// Resolve retained script/table tensor state before slicing; never reconstruct
// tensors from the magnetic scalar changes applied to the generated slices.
export function prepareRealSegmentedStack(project: Project, state: SerialOpticalState,
  engine: Pick<RealCalculationEngine, 'segmentation' | 'dielectricTensor'>) {
  if (project.calculation.roughnessModel !== 'segmentation') return undefined
  if (!engine.segmentation) throw new Error('Adaptive segmentation requires an explicit error-function lookup and numerical engine.')
  const tensors = project.calculation.algorithm === 'matrix' ? project.sample.layers.map((layer, index) => {
    const retained = state.dielectricState?.[index]
    if (retained) return retained
    const override = state.dielectricTensors[index]
    return override ? { values: override, anisotropic: true } : engine.dielectricTensor({
      layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag,
        layer.magnetization.gamma, layer.magnetization.phi],
      tensor: project.calculation.tensorContribution === 'tetragonal' ? 1 : 0,
      magnetic: project.calculation.magnetization.mode === 'none' ? 0 : 1,
    })
  }) : undefined
  return prepareSegmentedCompoundStack(project, copyLayerDepths(project, state.layerDepths), engine.segmentation.errorSamples, engine.segmentation, tensors)
}
