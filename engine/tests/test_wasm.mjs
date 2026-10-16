import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { calculateParratt } from '../wasm/parratt.mjs'

const factory = (await import(pathToFileURL(process.argv[2]).href)).default
const module = await factory()
const cases = JSON.parse(readFileSync(0, 'utf8'))
let count = 0, maxLogError = 0, zeros = 0, nonpositiveMismatches = 0
for (const [caseIndex, prepared] of cases.entries()) {
  const snapshot = JSON.stringify(prepared)
  const actual = calculateParratt(module, prepared)
  assert.equal(JSON.stringify(prepared), snapshot)
  actual.forEach((value, index) => {
    const target = prepared.expected[index]
    assert.ok(Number.isFinite(value))
    assert.ok(Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target),
      `case ${caseIndex} point ${index}: ${value} vs ${target}`)
    if (value > 0 && target > 0) {
      const relative = (value - target) / target
      const error = Math.abs(relative) < .5 ? Math.abs(Math.log1p(relative) / Math.LN10)
        : Math.abs(Math.log10(value) - Math.log10(target))
      maxLogError = Math.max(maxLogError, error)
    } else if (value === 0 && target === 0) zeros++
    else nonpositiveMismatches++
    count++
  })
}
assert.equal(count, 4320)
const prepared = cases[0]
const before = calculateParratt(module, prepared)
const oldBuffer = module.HEAPF64.buffer
const largeAllocation = module._malloc(oldBuffer.byteLength + 1024)
assert.ok(largeAllocation)
assert.notEqual(module.HEAPF64.buffer, oldBuffer)
module._free(largeAllocation)
assert.deepEqual(calculateParratt(module, prepared), before)
assert.throws(() => calculateParratt(module, { ...prepared, beam: [NaN, 0, 0, 0] }), TypeError)
assert.throws(() => calculateParratt(module, { ...prepared, points: [[.1, 0, 0]] }), { status: 1 })
assert.throws(() => calculateParratt(module, { ...prepared,
  layers: [[0, 0, 1e308, 1e308, 0, 0, 90, 90], [0, 0, 0, 0, 0, 0, 90, 90]] }), { status: 2 })
assert.deepEqual(calculateParratt(module, prepared), before)
assert.equal(module._remagx_parratt(0, 2, 0, 1, 0, 0, 0, 0), 1)
// Exercise partial-allocation cleanup without exhausting the process's real memory.
let allocations = 0
const outstanding = new Set()
const failingAllocator = new Proxy(module, {
  get(target, key) {
    if (key === '_malloc') return bytes => {
      if (++allocations === 3) return 0
      const pointer = target._malloc(bytes)
      outstanding.add(pointer)
      return pointer
    }
    if (key === '_free') return pointer => {
      assert.ok(outstanding.delete(pointer))
      target._free(pointer)
    }
    return target[key]
  },
})
assert.throws(() => calculateParratt(failingAllocator, prepared), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.deepEqual(calculateParratt(module, prepared), before)
console.log(`WASM/native: ${count} comparisons; max log10 error ${maxLogError} decades; ${zeros} zero pairs; ${nonpositiveMismatches} nonpositive mismatches; memory growth and error recovery passed`)
