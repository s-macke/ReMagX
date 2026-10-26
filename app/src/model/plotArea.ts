import type { CalculatedCurve } from './plotCoordinates'
import type { MeasuredCurve } from './datasets'

export interface PlotArea { min: number; max: number }
export interface PlotLineSource { label: string; x: number[]; y: number[] }

export function selectedPlotArea(first: number, last: number): PlotArea | null {
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === last) return null
  return { min: Math.min(first, last), max: Math.max(first, last) }
}

// The original uses chart series index 1 (second series), even for spectra/two beams.
// Held reference curves and fitted overlays never replace an absent input series.
export function plotLineSource(curve: CalculatedCurve | null, measured: { label: string; curve: MeasuredCurve }[], logX: boolean, logY: boolean): PlotLineSource | null {
  if (!curve) return null
  const second = curve.series[1]
  const input = second ? { label: second.label, x: curve.x, y: second.y }
    : measured[0] ? { label: measured[0].label, ...measured[0].curve } : null
  if (!input) return null
  const indices = input.x.flatMap((x, i) => Number.isFinite(x) && Number.isFinite(input.y[i]) &&
    (!logX || x > 0) && (!logY || input.y[i] > 0) ? [i] : [])
  return { label: input.label, x: indices.map(i => input.x[i]), y: indices.map(i => input.y[i]) }
}

export function selectedLineSamples(source: PlotLineSource, area: PlotArea): PlotLineSource {
  if (!selectedPlotArea(area.min, area.max) || area.min > area.max) throw new Error('Select a nonzero x interval first.')
  if (source.x.length !== source.y.length || !source.x.every(Number.isFinite) || !source.y.every(Number.isFinite)) throw new Error('Line fitting needs finite paired x/y samples.')
  const indices = source.x.flatMap((x, index) => x >= area.min && x <= area.max ? [index] : [])
  if (!indices.length) throw new Error('The selected area contains no samples of the second plot series.')
  if (new Set(indices.map(index => source.x[index])).size < 2) throw new Error('Line fitting needs at least two distinct x coordinates in the selected area.')
  return { label: source.label, x: indices.map(index => source.x[index]), y: indices.map(index => source.y[index]) }
}
