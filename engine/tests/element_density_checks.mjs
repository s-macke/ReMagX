// Shared Node/Chromium actual-module checks with synthetic table input only.
export function checkElementDensity(module, calculate) {
  const ensure = (condition, message) => { if (!condition) throw new Error(message) }
  const failure = (operation, predicate) => {
    try { operation() } catch (error) {
      ensure(predicate(error), `Unexpected element density failure: ${error}`)
      return
    }
    throw new Error('Expected element density failure')
  }
  const request = { slabs: [[999, 10, 4], [10, 10, 4], [999, 10, 4]],
    positions: [5, 7], errorSamples: Array(1001).fill(0) }
  const same = result => ensure(JSON.stringify(Array.from(result)) === '[4,4]', 'Element density result mismatch')
  const snapshot = JSON.stringify(request)
  const before = calculate(module, request)
  same(before)
  for (const change of [{ slabs: [] }, { slabs: new Array(2) }, { slabs: [[0, 1]] },
    { slabs: [new Array(3)] }, { slabs: [[0, -1, 2]] }, { slabs: [[-1, 0, 2]] },
    { slabs: [[0, 1, NaN]] }, { positions: [] }, { positions: new Array(2) },
    { positions: [Infinity] }, { errorSamples: undefined },
    { errorSamples: Array(1000).fill(0) }, { errorSamples: new Array(1001) }]) {
    failure(() => calculate(module, { ...request, ...change }), error => error instanceof TypeError)
  }
  const oldBuffer = module.HEAPF64.buffer
  const large = module._malloc(oldBuffer.byteLength + 1024)
  ensure(large && oldBuffer !== module.HEAPF64.buffer, 'Element density memory did not grow')
  try { same(calculate(module, request)); same(before) } finally { module._free(large) }
  for (let failAt = 1; failAt <= 4; failAt++) {
    let allocations = 0
    const outstanding = new Set()
    const wrapped = new Proxy(module, {
      get(target, key) {
        if (key === '_malloc') return bytes => {
          if (++allocations === failAt) return 0
          const pointer = target._malloc(bytes); outstanding.add(pointer); return pointer
        }
        if (key === '_free') return pointer => {
          ensure(outstanding.delete(pointer), 'Element density invalid free'); target._free(pointer)
        }
        return target[key]
      },
    })
    failure(() => calculate(wrapped, request), error => /allocation failed/.test(error.message))
    ensure(outstanding.size === 0, 'Element density allocation failure leaked')
    const overflow = { ...request, slabs: [[0, 1, 2], [0, 1, 3]], positions: [-100, 0],
      errorSamples: Array.from({ length: 1001 }, (_, index) => index % 2 ? 1e308 : -1e308) }
    failure(() => calculate(wrapped, overflow), error => error.status === 2)
    ensure(outstanding.size === 0, 'Element density numerical failure leaked')
    failure(() => calculate(wrapped, { ...request, slabs: [[0, 0, 2]], positions: [-100, 100] }), error => error.status === 2)
    ensure(outstanding.size === 0, 'Element density normalization failure leaked')
    same(calculate(wrapped, request))
    ensure(outstanding.size === 0, 'Element density recovery leaked')
  }
  ensure(snapshot === JSON.stringify(request), 'Element density inputs changed')
  same(before)
}
