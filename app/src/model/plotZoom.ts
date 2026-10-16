export interface PlotRange { min: number; max: number }

// Legacy Chart1 wheel zoom centers a half-width (in) or double-width (out) view at
// the pointer. Logarithmic axes use distances in log space, preserving positive bounds.
export function zoomPlotRange(range: PlotRange, center: number, factor: number, logarithmic = false): PlotRange | null {
  const transform = logarithmic ? Math.log : (value: number) => value
  const inverse = logarithmic ? Math.exp : (value: number) => value
  const lower = transform(range.min)
  const upper = transform(range.max)
  const middle = transform(center)
  if (![lower, upper, middle, factor].every(Number.isFinite) || upper <= lower || factor <= 0) return null
  const half = (upper - lower) * factor / 2
  const min = inverse(middle - half)
  const max = inverse(middle + half)
  return Number.isFinite(min) && Number.isFinite(max) && max > min && (!logarithmic || min > 0) ? { min, max } : null
}
