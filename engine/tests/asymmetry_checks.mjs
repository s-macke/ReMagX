import assert from 'node:assert/strict'

// Passing each beam separately does not prove the cancellation-sensitive difference.
export function checkAsymmetry(actual, expected, label) {
  let count = 0
  for (let index = 0; index < expected.length; index += 2) {
    const difference = actual[index] - actual[index + 1]
    const referenceDifference = expected[index] - expected[index + 1]
    const sum = actual[index] + actual[index + 1]
    const referenceSum = expected[index] + expected[index + 1]
    const pairs = [[difference, referenceDifference],
      [sum === 0 ? 0 : difference / sum, referenceSum === 0 ? 0 : referenceDifference / referenceSum]]
    for (const [value, target] of pairs) {
      assert.ok(Number.isFinite(value) && Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target),
        `${label}, asymmetry point ${index / 2}: ${value} vs ${target}`)
      count++
    }
  }
  return count
}
