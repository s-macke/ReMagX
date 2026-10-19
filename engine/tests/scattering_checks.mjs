// Shared Node/Chromium checks exercise the actual WASM adapter and memory.
export function checkScattering(module, calculate, cases) {
  const ensure = (condition, message) => { if (!condition) throw new Error(message) }
  const expectFailure = (operation, predicate) => {
    try { operation() } catch (error) {
      ensure(predicate(error), `Unexpected scattering failure: ${error}`)
      return
    }
    throw new Error('Expected scattering failure')
  }
  let count = 0
  for (const item of cases) {
    const snapshot = JSON.stringify(item)
    const actual = calculate(module, item)
    ensure(actual.length === 18, 'Scattering shape')
    actual.forEach((value, index) => {
      ensure(Math.abs(value - item.expected[index]) <= 1e-15 + 1e-10 * Math.abs(item.expected[index]), 'Scattering native mismatch')
      count++
    })
    ensure(JSON.stringify(item) === snapshot, 'Scattering input changed')
  }
  const prepared = cases[1]
  const before = calculate(module, prepared)
  const baseline = Array.from(before)
  const same = value => ensure(value.length === baseline.length && value.every((entry, index) => entry === baseline[index]), 'Scattering recovery mismatch')
  for (const change of [
    { factors: [] }, { factors: new Array(4) }, { factors: [1, NaN, 3, 4] },
    { factors: [1, 2, 3, Infinity] }, { gamma: NaN }, { phi: Infinity },
    { tensor: 2 }, { magnetic: -1 },
  ]) expectFailure(() => calculate(module, { ...prepared, ...change }), error => error instanceof TypeError)
  const oldBuffer = module.HEAPF64.buffer
  const large = module._malloc(oldBuffer.byteLength + 1024)
  ensure(large && oldBuffer !== module.HEAPF64.buffer, 'Scattering memory did not grow')
  try { same(calculate(module, prepared)); same(before) } finally { module._free(large) }
  for (const failAt of [1, 2, 0]) {
    let allocations = 0
    const outstanding = new Set()
    const wrapped = new Proxy(module, {
      get(target, key) {
        if (key === '_malloc') return bytes => {
          if (++allocations === failAt) return 0
          const pointer = target._malloc(bytes)
          outstanding.add(pointer)
          return pointer
        }
        if (key === '_free') return pointer => {
          ensure(outstanding.delete(pointer), 'Scattering buffer freed incorrectly')
          target._free(pointer)
        }
        // Simulate native failure after allocation to verify finally cleanup.
        if (!failAt && key === '_remagx_scattering_tensor') return () => 2
        return target[key]
      },
    })
    expectFailure(() => calculate(wrapped, prepared), error => failAt ? /allocation failed/.test(error.message) : error.status === 2)
    ensure(outstanding.size === 0, 'Scattering allocation leaked')
    same(calculate(module, prepared))
  }
  const copied = calculate(module, prepared)
  copied.fill(123)
  same(calculate(module, prepared))
  return count
}
