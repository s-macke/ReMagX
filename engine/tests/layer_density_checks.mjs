// Shared actual-module checks; the table here is synthetic test input only.
export function checkLayerDensity(module, calculate) {
  const ensure = (condition, message) => { if (!condition) throw new Error(message) }
  const failure = (operation, predicate) => {
    try { operation() } catch (error) {
      ensure(predicate(error), `Unexpected density failure: ${error}`)
      return
    }
    throw new Error('Expected density failure')
  }
  const request = { boundaries: [0, 10, 20], roughness: [10, 10, 10], layerIndex: 1,
    positions: [5, 7], errorSamples: Array(1001).fill(0) }
  const same = result => ensure(JSON.stringify(Array.from(result)) === '[0.25,0.25]', 'Density result mismatch')
  const snapshot = JSON.stringify(request)
  const before = calculate(module, request)
  same(before)
  for (const change of [{ boundaries: [] }, { boundaries: new Array(3) }, { roughness: [1] },
    { roughness: [1, NaN, 1] }, { layerIndex: -1 }, { layerIndex: 3 }, { layerIndex: .5 },
    { positions: [] }, { positions: new Array(2) }, { positions: [Infinity] },
    { errorSamples: undefined }, { errorSamples: Array(1000).fill(0) }, { errorSamples: new Array(1001) }]) {
    failure(() => calculate(module, { ...request, ...change }), error => error instanceof TypeError)
  }
  const oldBuffer = module.HEAPF64.buffer
  const large = module._malloc(oldBuffer.byteLength + 1024)
  ensure(large && oldBuffer !== module.HEAPF64.buffer, 'Density memory did not grow')
  try { same(calculate(module, request)); same(before) } finally { module._free(large) }
  for (let failAt = 1; failAt <= 5; failAt++) {
    let allocations = 0
    const outstanding = new Set()
    const wrapped = new Proxy(module, {
      get(target, key) {
        if (key === '_malloc') return bytes => {
          if (++allocations === failAt) return 0
          const pointer = target._malloc(bytes); outstanding.add(pointer); return pointer
        }
        if (key === '_free') return pointer => {
          ensure(outstanding.delete(pointer), 'Density invalid free'); target._free(pointer)
        }
        return target[key]
      },
    })
    failure(() => calculate(wrapped, request), error => /allocation failed/.test(error.message))
    ensure(outstanding.size === 0, 'Density allocation failure leaked')
    const overflow = { ...request, layerIndex: 0, roughness: [1, 1, 1], positions: [-100, 0],
      errorSamples: Array.from({ length: 1001 }, (_, index) => index % 2 ? 1e308 : -1e308) }
    failure(() => calculate(wrapped, overflow), error => error.status === 2)
    ensure(outstanding.size === 0, 'Density numerical failure leaked')
    same(calculate(wrapped, request))
    ensure(outstanding.size === 0, 'Density recovery leaked')
  }
  ensure(snapshot === JSON.stringify(request), 'Density inputs changed')
  same(before)
}
