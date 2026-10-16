import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { calculateParratt, calculateParrattQz } from '../wasm/parratt.mjs'

const factory = (await import(pathToFileURL(process.argv[2]).href)).default
const module = await factory()
const input = JSON.parse(readFileSync(0, 'utf8'))
const cases = [...input.angular, ...input.qz.map(prepared => ({ ...prepared, kind: 'qz' }))]
const calculate = prepared => prepared.kind === 'qz' ? calculateParrattQz(module, prepared) : calculateParratt(module, prepared)
let count = 0, maxLogError = 0, zeros = 0, nonpositiveMismatches = 0
for (const [caseIndex, prepared] of cases.entries()) {
  const snapshot = JSON.stringify(prepared)
  const actual = calculate(prepared)
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
assert.equal(count, 7680)
const prepared = cases[0]
const before = calculateParratt(module, prepared)
const qzPrepared = input.qz[1]
const qzBefore = calculateParrattQz(module, qzPrepared)
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
assert.deepEqual(calculateParrattQz(module, qzPrepared), qzBefore)
const limit = 2 * (2 * Math.PI / (12398.326 / qzPrepared.energy))
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, qz: [.01, limit], mode: 0 }), { status: 4 })
assert.ok(calculateParrattQz(module, { ...qzPrepared, qz: [limit] }).every(Number.isFinite))
assert.deepEqual(Array.from(calculateParrattQz(module, { ...qzPrepared, qz: [-limit] })), [0, 0])
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, qz: [] }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, qz: new Array(2) }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, layers: new Array(2) }), TypeError)
assert.throws(() => calculateParratt(module, { ...prepared, beam: new Array(4) }), TypeError)
assert.throws(() => calculateParratt(module, { ...prepared, points: [new Array(3)] }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, energy: 0 }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, beam2: null }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared,
  layers: [[0, 0, 1e308, 1e308, 0, 0, 90, 90], [0, 0, 0, 0, 0, 0, 90, 90]] }), { status: 2 })
assert.deepEqual(calculateParrattQz(module, qzPrepared), qzBefore)
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
allocations = 0
assert.throws(() => calculateParrattQz(failingAllocator, qzPrepared), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.deepEqual(calculateParrattQz(module, qzPrepared), qzBefore)
assert.deepEqual(calculateParratt(module, prepared), before)
console.log(`WASM/native: ${count} comparisons; max log10 error ${maxLogError} decades; ${zeros} zero pairs; ${nonpositiveMismatches} nonpositive mismatches; memory growth and error recovery passed`)
