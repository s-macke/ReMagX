// What each fit-parameter target refers to, how it is labelled, and how its value is read from
// and written to the project (legacy CStateHandler::ImplementFitVariable / TransferToFitVariables).

import type { FitParameter, FitTargetKind, Project } from './project'

export type TargetIndexKind = 'layer' | 'profileFunction' | 'elementSlab' | 'element' | 'scriptParameter' | 'none'

interface TargetInfo {
  label: string
  index: TargetIndexKind
}

export const fitTargetInfo: Record<FitTargetKind, TargetInfo> = {
  thickness: { label: 'thickness', index: 'layer' },
  delta: { label: 'δ', index: 'layer' },
  beta: { label: 'β', index: 'layer' },
  roughness: { label: 'σ', index: 'layer' },
  deltaMag: { label: 'δm', index: 'layer' },
  betaMag: { label: 'βm', index: 'layer' },
  angularResolution: { label: 'angular resolution', index: 'none' },
  intensityScale: { label: 'intensity scale', index: 'none' },
  qzShift: { label: 'qz shift', index: 'none' },
  profileDeltaAmplitude: { label: 'profile δ amplitude', index: 'profileFunction' },
  profileBetaAmplitude: { label: 'profile β amplitude', index: 'profileFunction' },
  profileWidth: { label: 'profile width', index: 'profileFunction' },
  profileCenter: { label: 'profile center', index: 'profileFunction' },
  scriptParameter: { label: 'script parameter', index: 'scriptParameter' },
  elementDensity: { label: 'element density', index: 'elementSlab' },
  elementThickness: { label: 'element thickness', index: 'elementSlab' },
  elementRoughness: { label: 'element σ', index: 'elementSlab' },
  betaKramersKronig: { label: 'β (Kramers-Kronig)', index: 'layer' },
  deltaKramersKronig: { label: 'δ (Kramers-Kronig)', index: 'layer' },
  elementF1: { label: 'element f1', index: 'element' },
  elementF2: { label: 'element f2', index: 'element' },
  elementF1Mag: { label: 'element f1m', index: 'element' },
  elementF2Mag: { label: 'element f2m', index: 'element' },
  electronEscapeDepth: { label: 'electron escape depth', index: 'layer' },
  electronGain: { label: 'electron gain', index: 'layer' },
  energyShift: { label: 'energy shift', index: 'none' },
  magnetizationGamma: { label: 'magnetization γ', index: 'none' },
  magnetizationPhi: { label: 'magnetization φ', index: 'none' },
}

export function layerName(project: Project, index: number): string {
  if (index === 0) return 'bulk'
  if (index === project.sample.layers.length - 1) return 'air'
  return `layer ${index}`
}

export function fitParameterName(project: Project, p: FitParameter): string {
  const info = fitTargetInfo[p.target]
  const element = p.elementIndex !== null ? project.sample.elementProfiles[p.elementIndex]?.element ?? `element ${p.elementIndex}` : ''
  switch (info.index) {
    case 'layer':
      return `${info.label} (${p.index === null ? '?' : layerName(project, p.index)})`
    case 'profileFunction':
      return `${info.label} (M${(p.index ?? 0) + 1})`
    case 'scriptParameter':
      return `script parameter ${p.index ?? '?'}`
    case 'elementSlab':
      return `${info.label} (${element}, slab ${p.index ?? '?'})`
    case 'element':
      return `${info.label} (${element})`
    case 'none':
      return info.label
  }
}

const layerField = {
  thickness: 'thickness',
  delta: 'delta',
  beta: 'beta',
  roughness: 'roughness',
  deltaMag: 'deltaMag',
  betaMag: 'betaMag',
  electronEscapeDepth: 'electronEscapeDepth',
} as const

// Returns a reference (getter/setter pair) to the project value a parameter fits, or undefined
// if the target does not exist in this project or has no stored value (Kramers-Kronig, gain).
function locate(project: Project, p: FitParameter): { get: () => number; set: (v: number) => void } | undefined {
  const i = p.index ?? -1
  const dataset = project.activeDatasetIndex === null ? undefined : project.datasets[project.activeDatasetIndex]
  const target = p.target
  if (target in layerField) {
    const layer = project.sample.layers[i]
    const field = layerField[target as keyof typeof layerField]
    return layer && { get: () => layer[field], set: (v) => void (layer[field] = v) }
  }
  switch (target) {
    case 'angularResolution':
      return { get: () => project.experiment.resolution.angularFwhm, set: (v) => void (project.experiment.resolution.angularFwhm = v) }
    case 'intensityScale':
      return dataset && { get: () => dataset.intensityScale, set: (v) => void (dataset.intensityScale = v) }
    case 'qzShift':
      return dataset && { get: () => dataset.qzShift, set: (v) => void (dataset.qzShift = v) }
    case 'energyShift':
      return dataset && { get: () => dataset.energyShift, set: (v) => void (dataset.energyShift = v) }
    case 'magnetizationGamma':
      return { get: () => project.calculation.magnetization.direction.gamma, set: (v) => void (project.calculation.magnetization.direction.gamma = v) }
    case 'magnetizationPhi':
      return { get: () => project.calculation.magnetization.direction.phi, set: (v) => void (project.calculation.magnetization.direction.phi = v) }
    case 'scriptParameter':
      return i >= 0 && i < project.scripts.parameters.length
        ? { get: () => project.scripts.parameters[i], set: (v) => void (project.scripts.parameters[i] = v) }
        : undefined
  }
  const fn = project.sample.depthProfileFunctions[i]
  if (fn) {
    if (target === 'profileDeltaAmplitude') return { get: () => fn.deltaAmplitude, set: (v) => void (fn.deltaAmplitude = v) }
    if (target === 'profileBetaAmplitude') return { get: () => fn.betaAmplitude, set: (v) => void (fn.betaAmplitude = v) }
    if (target === 'profileWidth') return { get: () => fn.width, set: (v) => void (fn.width = v) }
    if (target === 'profileCenter') return { get: () => fn.center, set: (v) => void (fn.center = v) }
  }
  const element = p.elementIndex === null ? undefined : project.sample.elementProfiles[p.elementIndex]
  if (element) {
    if (target === 'elementF1') return { get: () => element.f1, set: (v) => void (element.f1 = v) }
    if (target === 'elementF2') return { get: () => element.f2, set: (v) => void (element.f2 = v) }
    if (target === 'elementF1Mag') return { get: () => element.f1Mag, set: (v) => void (element.f1Mag = v) }
    if (target === 'elementF2Mag') return { get: () => element.f2Mag, set: (v) => void (element.f2Mag = v) }
    const slab = element.slabs[i]
    if (slab) {
      if (target === 'elementDensity') return { get: () => slab.density, set: (v) => void (slab.density = v) }
      if (target === 'elementThickness') return { get: () => slab.thickness, set: (v) => void (slab.thickness = v) }
      if (target === 'elementRoughness') return { get: () => slab.roughness, set: (v) => void (slab.roughness = v) }
    }
  }
  return undefined
}

export function readFitTarget(project: Project, p: FitParameter): number | undefined {
  return locate(project, p)?.get()
}

// Writes the value into the project (mutates; pass a copy). Returns false if the target is missing.
export function writeFitTarget(project: Project, p: FitParameter, value: number): boolean {
  const ref = locate(project, p)
  ref?.set(value)
  return ref !== undefined
}

// A new parameter starting at the current project value, bounded to ±50 % (legacy users set
// bounds by hand; this is only a starting point).
export function createFitParameter(project: Project, target: FitTargetKind, index: number | null, elementIndex: number | null): FitParameter {
  const draft: FitParameter = { target, index, elementIndex, value: 0, step: 0, lowerBound: 0, upperBound: 0 }
  const value = readFitTarget(project, draft) ?? 0
  const span = Math.abs(value) * 0.5 || 1
  return { ...draft, value, step: Math.abs(0.05 * value) || 0.05, lowerBound: value - span, upperBound: value + span }
}
