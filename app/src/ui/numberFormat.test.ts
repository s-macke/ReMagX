import { expect, test } from 'vitest'
import { formatNumber, parseNumber } from './numberFormat'

test('displayed numbers recover the exact stored double when edited or copied', () => {
  for (const value of [0, -0, 1.2345678901234567, -1234.5678901234567,
    1.2345678901234567e-8, 1.2345678901234567e20, 0.001, 100000,
    Number.MIN_VALUE, Number.MAX_VALUE, 1 + Number.EPSILON]) {
    expect(Object.is(parseNumber(formatNumber(value)), value)).toBe(true)
  }
})
