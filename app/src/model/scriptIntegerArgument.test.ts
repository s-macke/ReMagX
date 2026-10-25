import { expect, it } from 'vitest'
import { scriptIntegerArgument } from './scriptIntegerArgument'

it('converts original signed array integer arguments with nearest-even ties', () => {
  for (const [input, expected] of [[1.8, 2], [1.5, 2], [2.5, 2], [-1.5, -2], [-2.5, -2],
    [0.5, 0], [-0.5, 0], [-0, 0], [1.4999999999999998, 1], [1.5000000000000002, 2],
    [-0.5000000000000001, -1], [2147483647.4, 2147483647], [-2147483648.5, -2147483648]]) {
    expect(scriptIntegerArgument(input)).toBe(expected)
  }
  for (const input of [NaN, Infinity, -Infinity, 2147483647.5, -2147483648.6, Number.MAX_VALUE]) {
    expect(() => scriptIntegerArgument(input)).toThrow()
  }
})
