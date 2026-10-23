export interface AxisProperties { min: number; max: number; steps: number; logarithmic: boolean }
export interface PlotProperties {
  x: AxisProperties
  y: AxisProperties
  background: string
  border: string
  colors: string[]
  fontSize: number
  lineWidth: number
  points: boolean
}

export function validatePlotProperties(properties: PlotProperties): string | null {
  for (const key of ['x', 'y'] as const) {
    const axis = properties[key]
    if (!Number.isFinite(axis.min) || !Number.isFinite(axis.max) || axis.min >= axis.max) return `${key.toUpperCase()} maximum must be greater than its minimum.`
    if (axis.logarithmic && axis.min <= 0) return `${key.toUpperCase()} logarithmic range must be positive.`
    if (!Number.isInteger(axis.steps) || axis.steps < 1 || axis.steps > 30) return `${key.toUpperCase()} steps must be an integer from 1 to 30.`
  }
  if (!Number.isFinite(properties.fontSize) || properties.fontSize < 5 || properties.fontSize > 25) return 'Font size must be between 5 and 25.'
  if (!Number.isFinite(properties.lineWidth) || properties.lineWidth < 1 || properties.lineWidth > 10) return 'Line width must be between 1 and 10.'
  if ([properties.background, properties.border, ...properties.colors].some(color => !/^#[0-9a-f]{6}$/i.test(color))) return 'Choose valid colors.'
  return null
}

// Legacy Chart1 xSteps/ySteps are interval counts, including both end ticks. Log
// axes interpolate in log space; they are not restricted to powers of ten.
export function plotTicks(min: number, max: number, steps: number, logarithmic: boolean): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || (logarithmic && min <= 0) || !Number.isInteger(steps) || steps < 1 || steps > 30) return []
  const start = logarithmic ? Math.log(min) : min
  const end = logarithmic ? Math.log(max) : max
  return Array.from({ length: steps + 1 }, (_, i) => i === 0 ? min : i === steps ? max : logarithmic ? Math.exp(start + (end - start) * i / steps) : start + (end - start) * i / steps)
}

// Generate each decimal tick independently. Repeated addition can stop advancing
// outside a plotting library's finite increment table and block the UI thread.
export function logarithmicPlotTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || min >= max) return []
  const ticks: number[] = []
  for (let exponent = Math.floor(Math.log10(min)); exponent <= Math.ceil(Math.log10(max)); exponent++) {
    for (let multiplier = 1; multiplier <= 9; multiplier++) {
      const value = Number(`${multiplier}e${exponent}`)
      if (value >= min && value <= max && value > (ticks.at(-1) ?? 0)) ticks.push(value)
    }
  }
  return ticks
}
