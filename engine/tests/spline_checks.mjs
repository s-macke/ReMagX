// Shared checks run against the actual module in Node and a Chromium worker.
export function checkSpline(module, calculate) {
  const ensure = (value, message) => { if (!value) throw new Error(message) }
  const failure = (operation, predicate) => {
    try { operation() } catch (error) {
      ensure(predicate(error), `Unexpected spline failure: ${error}`)
      return
    }
    throw new Error('Expected spline failure')
  }
  const request = { profile: [0, 1, 2, -3], knots: [0, 1, 2, 3, 4], values: [0, 1, 2, 3, 4], positions: [1.5, 2.5] }
  const snapshot = JSON.stringify(request)
  const expected = [3, -4.5, 5, -7.5]
  const same = result => ensure(JSON.stringify(Array.from(result)) === JSON.stringify(expected), 'Spline output mismatch')
  const before = calculate(module, request)
  same(before)
  for (const change of [{ profile: new Array(4) }, { profile: [0, 1, 1, NaN] }, { knots: new Array(5) },
    { values: [0, 1] }, { values: [0, 1, Infinity, 3, 4] }, { positions: [] }, { positions: new Array(2) }]) {
    failure(() => calculate(module, { ...request, ...change }), error => error instanceof TypeError)
  }
  for (const count of [0, 1, 2, 3]) {
    const result = calculate(module, { ...request, knots: request.knots.slice(0, count), values: request.values.slice(0, count) })
    ensure(result.length === 4 && result.every(value => value === 0), 'Short spline must be zero')
  }
  // Force real heap growth and verify previously returned copies remain valid.
  const oldBuffer = module.HEAPF64.buffer
  const large = module._malloc(oldBuffer.byteLength + 1024)
  ensure(large && module.HEAPF64.buffer !== oldBuffer, 'Spline memory did not grow')
  try { same(calculate(module, request)); same(before) } finally { module._free(large) }
  for (const empty of [false, true]) {
    const prepared = empty ? { ...request, knots: [], values: [] } : request
    const allocationCount = empty ? 3 : 5
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
            ensure(outstanding.delete(pointer), 'Spline invalid free'); target._free(pointer)
          }
          return target[key]
        },
      })
      failure(() => calculate(wrapped, prepared), error => /allocation failed/.test(error.message))
      ensure(outstanding.size === 0, 'Spline allocation leaked')
      // Subsequent allocations succeed; test real native late failures/recovery.
      const endpoint = calculate(wrapped, { ...request, positions: [1.5, 1, 1 + Number.EPSILON] })
      ensure(endpoint[2] === 2 && endpoint[3] === -3, 'Spline stored endpoint mismatch')
      ensure(Math.abs(endpoint[4] - 2) < 1e-14 && Math.abs(endpoint[5] + 3) < 1e-14, 'Spline right limit mismatch')
      ensure(outstanding.size === 0, 'Spline endpoint evaluation leaked')
      failure(() => calculate(wrapped, { ...request, values: Array(5).fill(1e308), positions: [0, 1.5] }), error => error.status === 2)
      ensure(outstanding.size === 0, 'Spline numerical failure leaked')
      same(calculate(wrapped, request))
      ensure(outstanding.size === 0, 'Spline recovery leaked')
    }
  }
  ensure(snapshot === JSON.stringify(request), 'Spline inputs changed')
  same(before)
}
