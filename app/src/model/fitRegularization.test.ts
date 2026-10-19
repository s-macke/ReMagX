import { expect, it } from 'vitest'
import { addFitRegularization } from './fitRegularization'

it('adds the supported-target penalty to the dataset error without mutating either vector', () => {
  const reference = Object.freeze([10, 20, 30]), candidate = Object.freeze([8, 23, 30])
  expect(addFitRegularization(7, 2, reference, candidate)).toBe(33)
  expect(addFitRegularization(7, -2, reference, candidate)).toBe(-19)
  expect(addFitRegularization(7, 0, reference, candidate)).toBe(7)
  expect(addFitRegularization(7, 2, [], [])).toBe(7)
})

it('uses candidate magnitudes with a strict threshold and both signs', () => {
  expect(addFitRegularization(0, 1, [1, 1, 1], [0, -0, 1e-7])).toBe(0)
  expect(addFitRegularization(0, 1, [0], [1e-6])).toBe(1e-12)
  expect(addFitRegularization(0, 1, [0], [-1e-6])).toBe(1e-12)
  expect(addFitRegularization(0, 1, [1e-7], [1])).toBe((1e-7 - 1) * (1e-7 - 1))
})

it('preserves term multiplication and dataset-first accumulation order', () => {
  // Squaring before applying the weight would overflow; legacy order is finite.
  expect(addFitRegularization(0, 1e-300, [1e200], [1])).toBe(1e100)
  // Adding a pre-summed penalty would round differently from sequential terms.
  expect(addFitRegularization(1e16, 1, [2, 2], [1, 1])).toBe(1e16)
  // The reference is supplied anew, independently of previous calls.
  expect(addFitRegularization(0, 1, [10], [12])).toBe(4)
  expect(addFitRegularization(0, 1, [12], [12])).toBe(0)
})

it('rejects malformed and nonfinite inputs or accumulation overflow', () => {
  expect(() => addFitRegularization(0, 1, [], [1])).toThrow('inputs')
  expect(() => addFitRegularization(0, 1, Array(1), [1])).toThrow('inputs')
  expect(() => addFitRegularization(0, NaN, [1], [1])).toThrow('inputs')
  expect(() => addFitRegularization(Infinity, 1, [1], [1])).toThrow('inputs')
  expect(() => addFitRegularization(0, 1, [NaN], [1])).toThrow('inputs')
  expect(() => addFitRegularization(0, 1, [1], [Infinity])).toThrow('inputs')
  expect(() => addFitRegularization(0, 1e308, [3], [1])).toThrow('range')
})
