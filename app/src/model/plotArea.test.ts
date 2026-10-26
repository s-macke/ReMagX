import { expect, it } from 'vitest'
import { selectedPlotArea, plotLineSource, selectedLineSamples } from './plotArea'

it('orders reversed selections and rejects zero-width/nonfinite areas', () => {
  expect(selectedPlotArea(10, 2)).toEqual({ min: 2, max: 10 })
  expect(selectedPlotArea(2, 2)).toBeNull()
  expect(selectedPlotArea(NaN, 1)).toBeNull()
})
it('uses the second real series, not always measurement, and filters only invisible samples', () => {
  const curve = { axis: 'qz' as const, x: [-1, 1, 2], series: [{ label: 'first', y: [1, 2, 3] }], logScale: true, yLabel: 'R' }
  const measurement = [{ label: 'measurement', curve: { x: [-1, 1, 2], y: [3, -1, 5] } }]
  expect(plotLineSource(curve, measurement, false, false)).toEqual({ label: 'measurement', x: [-1, 1, 2], y: [3, -1, 5] })
  expect(plotLineSource(curve, measurement, true, true)).toEqual({ label: 'measurement', x: [2], y: [5] })
  expect(plotLineSource(curve, [], false, false)).toBeNull()
  curve.series.push({ label: 'second beam', y: [2, 3, 4] })
  expect(plotLineSource(curve, measurement, false, false)?.label).toBe('second beam')
})
it('includes endpoints and preserves sample ordering/data, with explicit empty/degenerate errors', () => {
  const source = { label: 'measured', x: [3, 2, 1], y: [9, 4, 1] }
  const before = structuredClone(source)
  expect(selectedLineSamples(source, { min: 1, max: 2 })).toEqual({ label: 'measured', x: [2, 1], y: [4, 1] })
  expect(() => selectedLineSamples(source, { min: 4, max: 5 })).toThrow('no samples')
  expect(() => selectedLineSamples(source, { min: 2, max: 2.5 })).toThrow('distinct')
  expect(source).toEqual(before)
})
