import { expect, it } from 'vitest'
import { angularResolutionCoordinates, combineAngularResolution } from '../../../engine/tests/angular_resolution_reference'

it('preserves the active 19 samples and the shifted single-sample small-width branch', () => {
  expect(angularResolutionCoordinates([1, 2], .1, false)).toHaveLength(38)
  const samples = angularResolutionCoordinates([1], .1, false)
  expect([samples[0], samples[9], samples[18]]).toEqual([.8, 1, 1.2])
  expect(angularResolutionCoordinates([1], 1e-11, false)).toEqual([1 - 2e-11])
  expect(angularResolutionCoordinates([1], 1e-10, false)).toHaveLength(19)
  expect(angularResolutionCoordinates([1, 2], .1, true)).toEqual([1, 2])
  expect(combineAngularResolution([1], new Float64Array([3, 4]), 0, false, true)).toEqual(new Float64Array([3, 4]))
})

it('keeps negative-qz losses instead of renormalizing the exact convolution', () => {
  const qz = angularResolutionCoordinates([0], .1, false)
  const values = new Float64Array(qz.flatMap(value => value < 0 ? [0, 0] : [1, 2]))
  const result = combineAngularResolution([0], values, .1, false, true)
  expect(result[0]).toBeCloseTo(.562430709959798, 13)
  expect(result[1]).toBe(result[0] * 2)
  expect(combineAngularResolution([0], values, .1, false, false)[1]).toBe(0)
})

it('preserves fast interpolation fallback and the legacy negative-qz initial value', () => {
  const values = new Float64Array([2, 3, 10, 11])
  // With only two points the forward-search loop never visits an interval.
  const result = combineAngularResolution([1, 2], values, .01, true, true)
  expect(result[0]).toBeCloseTo(2, 13)
  expect(result[2]).toBeLessThan(10)
  const crossing = combineAngularResolution([-.01, .01], new Float64Array([0, 0, 0, 0]), .1, true, true)
  expect(crossing[0]).toBeGreaterThan(0)
  expect(Array.from(values)).toEqual([2, 3, 10, 11])
  expect(() => combineAngularResolution([1], new Float64Array(), .1, false, true)).toThrow('Invalid')
  expect(() => angularResolutionCoordinates([1], -1, false)).toThrow('nonnegative')
})
