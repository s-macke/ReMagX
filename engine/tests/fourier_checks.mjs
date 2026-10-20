// The same adapter, native references and failure checks run in Node and Chromium.
export function checkFourier(module, calculate, cases) {
  const ensure = (condition, message) => { if (!condition) throw new Error(message) }
  const fails = (operation, predicate) => {
    try { operation() } catch (error) {
      ensure(predicate(error), `Unexpected Fourier failure: ${error}`)
      return
    }
    throw new Error('Expected Fourier failure')
  }
  let count = 0
  for (const item of cases) {
    const snapshot = JSON.stringify(item)
    const result = calculate(module, item.qz, item.reflectivity)
    for (const [column, name] of ['depths', 'magnitudes'].entries()) {
      ensure(result[name].length === item.expected[column].length, 'Fourier output length')
      result[name].forEach((value, index) => {
        const expected = item.expected[column][index]
        ensure(Number.isFinite(value) && Math.abs(value - expected) <= 1e-15 + 1e-10 * Math.abs(expected), `Fourier native mismatch: ${name}, ${index}`)
        count++
      })
    }
    ensure(JSON.stringify(item) === snapshot, 'Fourier mutated input')
  }
  const example = cases[3]
  const baseline = calculate(module, example.qz, example.reflectivity)
  const equal = output => {
    for (const key of ['depths', 'magnitudes'])
      ensure(output[key].every((value, index) => value === baseline[key][index]), 'Fourier recovery changed result')
  }
  for (const [qz, values] of [[[], []], [[1], [1]], [new Array(2), [1, 2]], [[1, 2], new Array(2)],
    [[1, NaN], [1, 2]], [[1, 2], [1, Infinity]], [[1, 2], [1]], [new Array(1000001), []]]) {
    fails(() => calculate(module, qz, values), error => error instanceof TypeError)
  }
  const oldMemory = module.HEAPF64.buffer
  const large = module._malloc(oldMemory.byteLength + 1024)
  ensure(large && oldMemory !== module.HEAPF64.buffer, 'Fourier memory did not grow')
  try { equal(calculate(module, example.qz, example.reflectivity)) } finally { module._free(large) }
  for (const failure of [1, 2, 3, 4, 0]) {
    let allocations = 0
    const owned = new Set()
    const wrapped = new Proxy(module, { get(target, key) {
      if (key === '_malloc') return bytes => {
        if (++allocations === failure) return 0
        const pointer = target._malloc(bytes)
        owned.add(pointer)
        return pointer
      }
      if (key === '_free') return pointer => {
        ensure(owned.delete(pointer), 'Fourier freed unowned buffer')
        target._free(pointer)
      }
      return target[key]
    } })
    fails(() => failure ? calculate(wrapped, example.qz, example.reflectivity) : calculate(wrapped, [.1, .2, .3, 1e-310], [1, 1, 1, 1]),
      error => failure ? /allocation failed/.test(error.message) : error.status === 2)
    ensure(owned.size === 0, 'Fourier leaked buffers')
    equal(calculate(module, example.qz, example.reflectivity))
  }
  const other = calculate(module, example.qz, example.reflectivity)
  other.depths[0] = 99
  other.magnitudes[0] = 99
  ensure(baseline.depths[0] === 0 && baseline.magnitudes[0] === 0, 'Fourier output buffers alias')
  return count
}
