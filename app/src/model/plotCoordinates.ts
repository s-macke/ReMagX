import { wavelengthFromEnergy } from './units'
import type { MeasuredCurve } from './datasets'

export interface CurveSeries {
  label: string
  y: number[]
}

export interface CalculatedCurve {
  axis: 'qz' | 'angle' | 'energy' | 'z' | 'depth'
  measured?: { label: string; curve: MeasuredCurve }[]
  x: number[]
  series: CurveSeries[]
  logScale: boolean
  yLabel: string
  boundaryMarks?: { x: number; y: number; seriesIndex: number }[]
}

type MeasurementSeries = { label: string; curve: MeasuredCurve }[]

// Legacy DrawReflectivity/DrawReflectivityMag use the current experiment energy for both
// simulation and measurement, after measurement shifts. qz = 2 k0 sin(theta).
export function angleFromQz(qz: number, energy: number): number {
  const sine = qz * wavelengthFromEnergy(energy) / (4 * Math.PI)
  if (!Number.isFinite(sine) || energy <= 0 || Math.abs(sine) > 1) {
    throw new Error('Cannot display theta: qz-value exceeds maximum for the current energy.')
  }
  return Math.asin(sine) * 180 / Math.PI
}

export function plotCoordinates(curve: CalculatedCurve | null, measured: MeasurementSeries, showAngle: boolean, energy: number): {
  curve: CalculatedCurve | null; measured: MeasurementSeries; error: string | null
} {
  if (curve?.axis === 'depth') return { curve, measured: curve.measured ?? [], error: null }
  if (!showAngle || curve?.axis !== 'qz') return { curve, measured, error: null }
  try {
    return {
      curve: { ...curve, axis: 'angle', x: curve.x.map(qz => angleFromQz(qz, energy)) },
      measured: measured.map(series => ({ ...series, curve: { ...series.curve, x: series.curve.x.map(qz => angleFromQz(qz, energy)) } })),
      error: null,
    }
  } catch (error) {
    return { curve: null, measured: [], error: (error as Error).message }
  }
}
