import { expect, it } from 'vitest'
import { plotTicks, validatePlotProperties, type PlotProperties } from './plotProperties'

const properties: PlotProperties = {
  x: { min: 0, max: 10, steps: 5, logarithmic: false },
  y: { min: 0.01, max: 1, steps: 2, logarithmic: true },
  background: '#ffffff', border: '#dddddd', colors: Array(8).fill('#ff0000'), fontSize: 12, lineWidth: 1.5, points: false,
}
it('validates increasing finite ranges, positive log bounds and legacy control limits', () => {
  expect(validatePlotProperties(properties)).toBeNull()
  expect(validatePlotProperties({ ...properties, x: { ...properties.x, logarithmic: true } })).toContain('positive')
  expect(validatePlotProperties({ ...properties, y: { ...properties.y, max: 0.001 } })).toContain('maximum')
  expect(validatePlotProperties({ ...properties, y: { ...properties.y, steps: 31 } })).toContain('steps')
  expect(validatePlotProperties({ ...properties, fontSize: NaN })).toContain('Font size')
})
it('uses interval counts in linear and logarithmic space, including end ticks', () => {
  expect(plotTicks(0, 10, 5, false)).toEqual([0, 2, 4, 6, 8, 10])
  const ticks = plotTicks(0.01, 1, 2, true)
  expect(ticks).toHaveLength(3)
  expect(ticks[1]).toBeCloseTo(0.1, 14)
  expect(ticks[0]).toBe(0.01)
  expect(ticks[2]).toBe(1)
  expect(plotTicks(0, 1, 2, true)).toEqual([])
})
