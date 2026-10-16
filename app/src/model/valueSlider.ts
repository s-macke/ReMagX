import type { Project } from './project'

export type ValueCell =
  | { kind: 'element'; index: number; field: 'f1' | 'f2' | 'f1Mag' | 'f2Mag' }
  | { kind: 'layer'; index: number; field: 'thickness' | 'density' | 'delta' | 'beta' | 'roughness' | 'deltaMag' | 'betaMag' | 'gamma' | 'phi' }
  | { kind: 'slab'; element: number; index: number; field: 'thickness' | 'density' | 'roughness' }
  | { kind: 'profile'; index: number; field: 'deltaAmplitude' | 'betaAmplitude' | 'center' | 'width' }
  | { kind: 'spline'; profile: number; index: number }
  | { kind: 'script'; index: number }

export interface ValueSliderSelection {
  target: ValueCell
  label: string
  originalValue: number
  position: number
}

function locate(project: Project, target: ValueCell): { value: number; set: (value: number) => void } | undefined {
  if (!Number.isInteger(target.index) || target.index < 0) return
  if (target.kind === 'element') {
    if (project.sample.mode !== 'element') return
    const element = project.sample.elementProfiles[target.index]
    if (!element) return
    return { value: element[target.field], set: value => { element[target.field] = value } }
  }
  if (target.kind === 'layer') {
    if (project.sample.mode !== 'compound') return
    const layers = project.sample.layers
    const layer = layers[target.index]
    if (!layer || (target.field === 'thickness' && (target.index === 0 || target.index === layers.length - 1)) ||
      (target.field === 'roughness' && target.index === layers.length - 1)) return
    const field = target.field
    if (field === 'gamma' || field === 'phi') return { value: layer.magnetization[field], set: value => { layer.magnetization[field] = value } }
    return { value: layer[field], set: value => { layer[field] = value } }
  }
  if (target.kind === 'slab') {
    if (project.sample.mode !== 'element') return
    const slabs = project.sample.elementProfiles[target.element]?.slabs
    const slab = slabs?.[target.index]
    if (!slab || !slabs || (target.field === 'thickness' && (target.index === 0 || target.index === slabs.length - 1)) ||
      (target.field === 'roughness' && target.index === slabs.length - 1)) return
    return { value: slab[target.field], set: value => { slab[target.field] = value } }
  }
  if (target.kind === 'profile') {
    const profile = project.sample.depthProfileFunctions[target.index]
    if (!profile || profile.spline.enabled) return
    return { value: profile[target.field], set: value => { profile[target.field] = value } }
  }
  if (target.kind === 'spline') {
    const spline = project.sample.depthProfileFunctions[target.profile]?.spline
    if (!spline?.enabled || target.index < 2 || target.index >= spline.points.length - 2) return
    return { value: spline.points[target.index].value, set: value => { spline.points[target.index].value = value } }
  }
  if (target.index >= project.scripts.parameters.length) return
  return { value: project.scripts.parameters[target.index], set: value => { project.scripts.parameters[target.index] = value } }
}

export function valueCellKey(target: ValueCell): string { return JSON.stringify(target) }
export function readValueCell(project: Project, target: ValueCell): number | undefined { return locate(project, target)?.value }

export function applyValueSlider(project: Project, selection: ValueSliderSelection, position: number): Project {
  if (!Number.isInteger(position) || position < 0 || position > 1000 || !locate(project, selection.target)) return project
  const value = position / 250 * selection.originalValue
  if (!Number.isFinite(value) || readValueCell(project, selection.target) === value) return project
  const result = { ...structuredClone({ ...project, datasets: [] }), datasets: project.datasets }
  locate(result, selection.target)!.set(value)
  return result
}
