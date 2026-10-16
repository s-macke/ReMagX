import { expect, it } from 'vitest'
import type { FitParameter } from './project'
import { prepareRealFitSimplex } from './realFitSimplex'

function parameter(value: number, lowerBound: number, upperBound: number, step = 999): FitParameter {
  return { target: 'thickness', index: 1, elementIndex: null, value, lowerBound, upperBound, step }
}

it('uses legacy metadata scales and independent normalized axes across physical units', () => {
  const parameters = [parameter(40, 0, 100), parameter(0, -1, 1, 0), parameter(0, -1e-9, 1e-9)]
  const before = structuredClone(parameters)
  const prepared = prepareRealFitSimplex(parameters)
  expect(prepared.simplex).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]])
  expect(prepared.simplex.map(prepared.decode)).toEqual([[40, 0, 0], [42, 0, 0], [40, .05, 0], [40, 0, 1e-9]])
  expect(prepared.decode(new Float64Array([.5, -.5, .5]))).toEqual([41, -.025, .5e-9])
  expect(parameters).toEqual(before)
  // Saved delta/step is overwritten by the original constructor, including zero.
  const changed = prepareRealFitSimplex(parameters.map(row => ({ ...row, step: -123 })))
  expect(changed.simplex.map(changed.decode))
    .toEqual(prepared.simplex.map(prepared.decode))
})

it('starts within bounds, reverses the axis at an upper bound, and retains fixed rows and signed zero', () => {
  const prepared = prepareRealFitSimplex([parameter(100, 0, 10), parameter(-5, 2, 2), parameter(-0, -1, 1)])
  expect(prepared.simplex).toEqual([[0, 0], [1, 0], [0, 1]])
  expect(prepared.decode([0, 0])).toEqual([10, 2, -0])
  expect(prepared.decode([1, 0])).toEqual([5, 2, -0])
  expect(prepared.decode([0, 1])).toEqual([10, 2, .05])
  // Trial coordinates may leave the bounds; ordered clipping belongs to candidate application.
  expect(prepared.decode([-1, 0])).toEqual([15, 2, -0])
  const fixed = prepareRealFitSimplex([parameter(8, 3, 3), parameter(-0, -0, 0)])
  expect(fixed.simplex).toEqual([])
  expect(fixed.decode([])).toEqual([3, -0])
  expect(prepareRealFitSimplex([]).decode([])).toEqual([])
})

it('keeps a distinct simplex vertex for adjacent and subnormal bounds', () => {
  for (const [lower, upper] of [[1, 1 + Number.EPSILON], [0, Number.MIN_VALUE], [-Number.MIN_VALUE, 0]]) {
    for (const value of [lower, upper]) {
      const prepared = prepareRealFitSimplex([parameter(value, lower, upper)])
      const base = prepared.decode([0])[0]
      const vertex = prepared.decode([1])[0]
      expect(vertex).not.toBe(base)
      expect(vertex >= lower && vertex <= upper).toBe(true)
    }
  }
})

it('rejects invalid bounds and candidates without corrupting reusable initialization', () => {
  for (const row of [parameter(NaN, 0, 1), parameter(0, 1, 0), parameter(0, 0, Infinity)]) {
    expect(() => prepareRealFitSimplex([row])).toThrow('Invalid value or bounds')
  }
  const prepared = prepareRealFitSimplex([parameter(40, 0, 100)])
  for (const candidate of [[], [1, 2], [NaN], [Infinity], [Number.MAX_VALUE]]) {
    expect(() => prepared.decode(candidate)).toThrow()
  }
  const values = prepared.decode([0]); values[0] = 999
  expect(prepared.decode([0])).toEqual([40])
})
