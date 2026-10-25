import { expect, it } from 'vitest'
import { angleFromQz, plotCoordinates, type CalculatedCurve } from './plotCoordinates'
import { HC_EV_ANGSTROM } from './units'

it('uses the legacy wavelength and theta (not twice theta), including the physical boundary', () => {
  const energy = HC_EV_ANGSTROM
  expect(angleFromQz(2 * Math.PI, energy)).toBeCloseTo(30, 12)
  expect(angleFromQz(4 * Math.PI, energy)).toBe(90)
  expect(angleFromQz(0, energy)).toBe(0)
  expect(() => angleFromQz(4 * Math.PI + 0.01, energy)).toThrow('exceeds maximum')
})

it('converts simulation and shifted measurements together without modifying the source or other axes', () => {
  const curve: CalculatedCurve = { axis: 'qz', x: [0, 2 * Math.PI], series: [{ label: 'R', y: [1, 0.1] }], logScale: true, yLabel: 'R' }
  const measured = [{ label: 'measured R', curve: { x: [2 * Math.PI], y: [0.2] } }]
  const result = plotCoordinates(curve, measured, true, HC_EV_ANGSTROM)
  expect(result.curve?.axis).toBe('angle')
  expect(result.curve?.x[1]).toBeCloseTo(30, 12)
  expect(result.measured[0].curve.x[0]).toBeCloseTo(30, 12)
  expect(result.curve?.series).toBe(curve.series)
  expect(curve.x).toEqual([0, 2 * Math.PI])
  expect(plotCoordinates(curve, measured, false, 700).curve).toBe(curve)
  for (const axis of ['energy', 'z'] as const) {
    const other = { ...curve, axis }
    expect(plotCoordinates(other, [], true, 700).curve).toBe(other)
  }
  const invalid = plotCoordinates(curve, measured, true, 1)
  expect(invalid.curve).toBeNull()
  expect(invalid.error).toContain('exceeds maximum')
})
