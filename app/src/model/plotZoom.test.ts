import { expect, it } from 'vitest'
import { zoomPlotRange } from './plotZoom'

it('centers wheel zoom on the pointer and doubles the extent for Zoom Out', () => {
  expect(zoomPlotRange({ min: 0, max: 10 }, 2, 0.5)).toEqual({ min: -0.5, max: 4.5 })
  expect(zoomPlotRange({ min: -0.5, max: 4.5 }, 2, 2)).toEqual({ min: -3, max: 7 })
})
it('zooms log axes in log space and rejects invalid or exhausted ranges', () => {
  const range = zoomPlotRange({ min: 1e-6, max: 1 }, 1e-3, 0.5, true)!
  expect(Math.log10(range.min)).toBeCloseTo(-4.5, 12)
  expect(Math.log10(range.max)).toBeCloseTo(-1.5, 12)
  expect(zoomPlotRange({ min: 0, max: 1 }, 0.5, 2, true)).toBeNull()
  expect(zoomPlotRange({ min: 1e-300, max: 1e300 }, 1, 2, true)).toBeNull()
  expect(zoomPlotRange({ min: 1, max: 1 }, 1, 0.5)).toBeNull()
})
