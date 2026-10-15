import { describe, expect, it } from 'vitest'

describe('toolchain', () => {
  it('runs tests in double precision arithmetic', () => {
    expect(0.1 + 0.2).toBeCloseTo(0.3, 15)
  })
})
