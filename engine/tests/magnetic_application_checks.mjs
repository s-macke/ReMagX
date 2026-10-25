// Run unchanged in Node and Chromium against the actual mixed-profile export.
export function checkMagneticApplication(module, calculate) {
  const ensure = (condition, message) => { if (!condition) throw new Error(message) }
  const failure = (operation, predicate) => {
    try { operation() } catch (error) {
      ensure(predicate(error), `Unexpected magnetic application failure: ${error}`)
      return
    }
    throw new Error('Expected magnetic application failure')
  }
  const request = {
    profiles: [[0, 1, 2, 3], [0, 1, 4, 5], [0, 1, 9, 9]],
    splines: [null, { knots: [-2, -1, 1, 2], values: [4, 4, 4, 4] }, { knots: [], values: [] }],
    positions: [0], initialValues: [10, 20], weights: [[1, .5, 1]], coupled: 1,
  }
  const same = result => ensure(JSON.stringify(Array.from(result)) === '[270,880]', 'Mixed application result mismatch')
  const snapshot = JSON.stringify(request)
  const before = calculate(module, request)
  same(before)
  ensure(JSON.stringify(Array.from(calculate(module, { ...request, coupled: 0 }))) === '[20,33]', 'Mixed additive result mismatch')
  for (const change of [{ profiles: new Array(3) }, { splines: [] }, { splines: new Array(3) },
    { splines: [null, { knots: [0, 1], values: [1] }, null] },
    { splines: [null, { knots: [0, 1], values: [NaN, 1] }, null] },
    { positions: [] }, { positions: [Infinity] }, { initialValues: [1] },
    { weights: [[1, 1]] }, { weights: new Array(1) }, { coupled: 2 }]) {
    failure(() => calculate(module, { ...request, ...change }), error => error instanceof TypeError)
  }
  const empty = { profiles: [], splines: [], positions: [0], initialValues: [10, 20], weights: [[]], coupled: 1 }
  ensure(JSON.stringify(Array.from(calculate(module, empty))) === '[10,20]', 'Empty profile copy')
  const gaussian = { ...request, splines: [null, null, null] }
  ensure(JSON.stringify(Array.from(calculate(module, gaussian))) === '[900,2800]', 'Gaussian descriptor dispatch')
  const skip = { ...request, positions: [-1], weights: [[0, 0, 1]] }
  ensure(JSON.stringify(Array.from(calculate(module, skip))) === '[10,20]', 'Zero-weight endpoint skip')
  const oldBuffer = module.HEAPF64.buffer
  const large = module._malloc(oldBuffer.byteLength + 1024)
  ensure(large && oldBuffer !== module.HEAPF64.buffer, 'Mixed application memory did not grow')
  try { same(calculate(module, request)); same(before) } finally { module._free(large) }
  for (const [prepared, allocationCount] of [[request, 8], [gaussian, 6], [empty, 3]]) {
    for (let failAt = 1; failAt <= allocationCount; failAt++) {
      let allocations = 0
      const outstanding = new Set()
      const wrapped = new Proxy(module, {
        get(target, key) {
          if (key === '_malloc') return bytes => {
            if (++allocations === failAt) return 0
            const pointer = target._malloc(bytes); outstanding.add(pointer); return pointer
          }
          if (key === '_free') return pointer => {
            ensure(outstanding.delete(pointer), 'Mixed application invalid free'); target._free(pointer)
          }
          return target[key]
        },
      })
      failure(() => calculate(wrapped, prepared), error => /allocation failed/.test(error.message))
      ensure(outstanding.size === 0, 'Mixed allocation failure leaked')
      for (const [coupled, expected] of [[0, '[18,30]'], [1, '[90,220]']]) {
        const result = calculate(wrapped, { ...request, positions: [-1], weights: [[0, .5, 0]], coupled })
        ensure(JSON.stringify(Array.from(result)) === expected, 'Mixed stored endpoint mismatch')
      }
      ensure(outstanding.size === 0, 'Mixed endpoint evaluation leaked')
      const overflow = { ...request, splines: [null, { knots: [-2, -1, 1, 2], values: Array(4).fill(1e308) }, null] }
      failure(() => calculate(wrapped, overflow), error => error.status === 2)
      ensure(outstanding.size === 0, 'Mixed numerical failure leaked')
      same(calculate(wrapped, request))
      ensure(outstanding.size === 0, 'Mixed recovery leaked')
    }
  }
  ensure(JSON.stringify(request) === snapshot, 'Mixed application inputs changed')
  same(before)
}
