import type uPlot from 'uplot'

export const SIMULATED_COLORS = ['#c0392b', '#2f6fd6', '#218c54', '#9854b3', '#bb7900', '#008b95', '#d04d86', '#69757d']
export const MEASURED_COLOR = '#2e9d4e'
export const HELD_COLOR = '#8a8f98'

export function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // CSS minification can shorten #ffffff to #fff; color inputs require six digits.
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value)
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : value || fallback
}

const isDecade = (v: number) => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9
export const formatDecade = (v: number) => {
  const exponent = Math.round(Math.log10(v))
  return exponent === 0 ? '1' : `1e${exponent}`
}

// Linear tick labels with enough digits for small quantities such as δ ≈ 1e-3.
export const formatLinearTicks = (_u: uPlot, splits: number[]) => {
  const step = splits.length > 1 ? Math.abs(splits[1] - splits[0]) : 1
  const largest = Math.max(...splits.map(Math.abs))
  const useExponent = largest !== 0 && (largest < 1e-2 || largest >= 1e5)
  const decimals = Math.max(0, Math.ceil(-Math.log10(step || 1)))
  return splits.map((v) => {
    if (Math.abs(v) < step * 1e-6) return '0'
    if (!useExponent) return v.toFixed(Math.min(decimals, 8))
    const digits = Math.max(0, Math.ceil(Math.log10(largest / step)) - 1)
    return v.toExponential(Math.min(digits, 6))
  })
}

// Keeps decades only, and only every n-th decade when the plot is too short for all labels.
const MIN_LABEL_SPACING_PX = 16
export const decadesOnly = (u: uPlot, splits: number[]) => {
  const decades = splits.filter((v) => v > 0 && isDecade(v))
  const heightPx = u.bbox.height / (window.devicePixelRatio || 1)
  const step = Math.max(1, Math.ceil((decades.length * MIN_LABEL_SPACING_PX) / Math.max(heightPx, 1)))
  return splits.map((v) => (v > 0 && isDecade(v) && Math.round(Math.log10(v)) % step === 0 ? v : null))
}

