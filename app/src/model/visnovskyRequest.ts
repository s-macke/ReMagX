import type { Project } from './project'
import { prepareCompoundLayerIndices, type PreparedCompoundLayer } from './compoundLayers'
import { prepareCompoundQzRequest, type PreparedParrattQzRequest } from './parrattRequest'

export type DielectricTensorCalculator = (request: { layer: PreparedCompoundLayer; tensor: 0 | 1; magnetic: 0 | 1 }) => {
  values: Float64Array; anisotropic: boolean
}
export interface PreparedVisnovskyQzRequest extends Omit<PreparedParrattQzRequest, 'layers' | 'tensor' | 'magnetic'> {
  layers: { values: number[]; anisotropic: 0 | 1 }[]
  epsilon: number
}

// Worker-only preparation: numerical tensor construction is injected from WASM.
// FillTensors uses per-layer directions and applies no second-beam reversal.
export function prepareVisnovskyQzRequest(project: Project, mode: 'monochromatic' | 'dichroic',
  constructTensor: DielectricTensorCalculator, dielectricTensors?: (Float64Array | null)[]): PreparedVisnovskyQzRequest {
  validateVisnovskyProject(project)
  if (dielectricTensors && dielectricTensors.length !== project.sample.layers.length) throw new Error('Invalid dielectric-tensor layer mapping.')
  const overrides = dielectricTensors && prepareCompoundLayerIndices(project).map(index => dielectricTensors[index])
  const { layers, tensor, magnetic, ...scan } = prepareCompoundQzRequest(project, mode)
  return { ...scan, epsilon: project.calculation.epsilon, layers: prepareVisnovskyLayers(layers, tensor, magnetic, constructTensor, overrides) }
}

export function validateVisnovskyProject(project: Project) {
  if (project.calculation.algorithm !== 'matrix') throw new Error('This real-engine path requires the matrix algorithm.')
  if (project.calculation.magnetization.mode === 'profile') throw new Error('Magnetization-profile preparation is not implemented in the matrix path yet.')
  if (!Number.isFinite(project.calculation.epsilon)) throw new Error('Matrix epsilon must be finite.')
}

export function prepareVisnovskyLayers(layers: PreparedCompoundLayer[], tensor: 0 | 1, magnetic: 0 | 1,
  constructTensor: DielectricTensorCalculator, overrides?: (Float64Array | null)[]): PreparedVisnovskyQzRequest['layers'] {
  if (overrides && overrides.length !== layers.length) throw new Error('Invalid dielectric-tensor layer mapping.')
  return layers.map((layer, index) => {
    const override = overrides?.[index]
    const dielectric = override ? { values: override, anisotropic: true } : constructTensor({ layer, tensor, magnetic })
    if (dielectric.values.length !== 18 || !dielectric.values.every(Number.isFinite) || typeof dielectric.anisotropic !== 'boolean') {
      throw new Error('The real engine returned an invalid dielectric tensor.')
    }
    return { values: [layer[0], layer[1], 1 - layer[2], layer[3], ...dielectric.values],
      anisotropic: dielectric.anisotropic ? 1 : 0 }
  })
}
