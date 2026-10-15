// Measured data as compared with the simulation. Like the legacy program (CDataSet::Adapt), the
// dataset's corrections are applied to the measurement: qz + qzShift, energy + energyShift and
// intensity (R + offset) * scale.

import type { Dataset, Project } from './project'

export interface MeasuredCurve {
  x: number[]
  y: number[]
}

export type MeasuredQuantity = 'reflectivity' | 'reflectivityPlus' | 'reflectivityMinus' | 'asymmetry'

export function activeDataset(project: Project): Dataset | undefined {
  const index = project.activeDatasetIndex
  return index === null ? undefined : project.datasets[index]
}

export function adaptedMeasurement(
  dataset: Dataset,
  quantity: MeasuredQuantity,
  axis: 'qz' | 'energy',
): MeasuredCurve | undefined {
  const values = dataset.columns[quantity]
  const xs = axis === 'qz' ? dataset.columns.qz : dataset.columns.energy
  if (!values || !xs) return undefined
  const shift = axis === 'qz' ? dataset.qzShift : dataset.energyShift
  const isIntensity = quantity !== 'asymmetry'
  const points = xs
    .map((x, i) => ({
      x: x + shift,
      y: isIntensity ? (values[i] + dataset.intensityOffset) * dataset.intensityScale : values[i],
    }))
    .sort((a, b) => a.x - b.x)
  return { x: points.map((p) => p.x), y: points.map((p) => p.y) }
}

// Moves a dataset by `offset` positions (±1), keeping the active dataset selected.
export function moveDataset(project: Project, index: number, offset: number): Project {
  const target = index + offset
  if (target < 0 || target >= project.datasets.length) return project
  const datasets = [...project.datasets]
  ;[datasets[index], datasets[target]] = [datasets[target], datasets[index]]
  const active = project.activeDatasetIndex
  const activeDatasetIndex = active === index ? target : active === target ? index : active
  return { ...project, datasets, activeDatasetIndex }
}

export function deleteDataset(project: Project, index: number): Project {
  const datasets = project.datasets.filter((_, i) => i !== index)
  const active = project.activeDatasetIndex
  let activeDatasetIndex: number | null = active
  if (active === index) activeDatasetIndex = datasets.length > 0 ? Math.min(index, datasets.length - 1) : null
  else if (active !== null && active > index) activeDatasetIndex = active - 1
  return { ...project, datasets, activeDatasetIndex }
}

export function updateDataset(project: Project, index: number, patch: Partial<Dataset>): Project {
  return { ...project, datasets: project.datasets.map((d, i) => (i === index ? { ...d, ...patch } : d)) }
}
