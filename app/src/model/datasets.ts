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
