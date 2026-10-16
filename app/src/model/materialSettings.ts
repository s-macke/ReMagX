import type { Project } from './project'
import { cellIsFitted, toggleCellFit } from './cellFit'

export interface MaterialSettings {
  formula: string
  density: number
  gamma: number
  phi: number
  fitGamma: boolean
  fitPhi: boolean
}

export function readMaterialSettings(project: Project, index: number): MaterialSettings | null {
  const layer = project.sample.layers[index]
  if (project.sample.mode !== 'compound' || !layer) return null
  return { formula: layer.material, density: layer.density, ...layer.magnetization,
    fitGamma: cellIsFitted(project, { target: 'magnetizationGamma', index, elementIndex: null }),
    fitPhi: cellIsFitted(project, { target: 'magnetizationPhi', index, elementIndex: null }) }
}

// Apply only edited fields to the latest project: a fit may finish while the dialog
// is open. Unchanged target settings (bounds, steps and start values) are preserved.
export function applyMaterialSettings(project: Project, index: number, initial: MaterialSettings, draft: MaterialSettings): Project {
  if (![draft.density, draft.gamma, draft.phi].every(Number.isFinite) || draft.density < 0) throw new Error('Density must be nonnegative and all numeric values must be finite.')
  const current = readMaterialSettings(project, index)
  if (!current || (Object.keys(initial) as (keyof MaterialSettings)[]).every(key => initial[key] === draft[key])) return project
  const layer = project.sample.layers[index]
  let result = { ...project, sample: { ...project.sample, layers: project.sample.layers.map((entry, i) => i !== index ? entry : {
    ...layer,
    material: draft.formula === initial.formula ? layer.material : draft.formula,
    density: draft.density === initial.density ? layer.density : draft.density,
    magnetization: {
      gamma: draft.gamma === initial.gamma ? layer.magnetization.gamma : draft.gamma,
      phi: draft.phi === initial.phi ? layer.magnetization.phi : draft.phi,
    },
  }) } }
  for (const [field, target] of [['fitGamma', 'magnetizationGamma'], ['fitPhi', 'magnetizationPhi']] as const) {
    if (draft[field] !== initial[field] && draft[field] !== current[field]) result = toggleCellFit(result, { target, index, elementIndex: null })
  }
  return result
}
