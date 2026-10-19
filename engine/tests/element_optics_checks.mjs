export function checkElementOptics(module, calculate, cases) {
  const ensure = (value, message) => { if (!value) throw new Error(message) }
  const failure = (operation, predicate) => {
    try { operation() } catch (error) {
      ensure(predicate(error), `Unexpected element optics failure: ${error}`)
      return
    }
    throw new Error('Expected element optics failure')
  }
  const flatten = result => [...result.opticalConstants, ...(result.dielectricTensor ?? [])]
  let count = 0
  for (const item of cases) {
    const before = JSON.stringify(item)
    const result = calculate(module, item)
    const values = flatten(result)
    ensure((result.dielectricTensor === null) === (item.scatteringTensors === null), 'Element matrix presence')
    ensure(values.length === item.expected.length, 'Element output shape')
    values.forEach((value, index) => {
      const expected = item.expected[index]
      ensure(Math.abs(value - expected) <= 1e-15 + 1e-10 * Math.abs(expected), 'Element optics native mismatch')
      count++
    })
    ensure(JSON.stringify(item) === before, 'Element inputs changed')
  }
  const prepared = cases.find(item => item.elements.length > 0 && item.scatteringTensors)
  const scalar = { ...prepared, scatteringTensors: null }
  for (const change of [
    { elements: new Array(2) }, { elements: [[1, 2, 3]] }, { elements: [[1, 2, NaN, 4, 5]] },
    { factor: Infinity }, { scatteringTensors: [] }, { scatteringTensors: new Array(prepared.elements.length) },
    { scatteringTensors: prepared.elements.map(() => new Array(18)) },
    { scatteringTensors: prepared.elements.map(() => Array(18).fill(Infinity)) },
  ]) failure(() => calculate(module, { ...prepared, ...change }), error => error instanceof TypeError)
  const before = calculate(module, prepared)
  const baseline = flatten(before)
  const same = result => ensure(JSON.stringify(flatten(result)) === JSON.stringify(baseline), 'Element recovery or copy mismatch')
  const oldBuffer = module.HEAPF64.buffer
  const large = module._malloc(oldBuffer.byteLength + 1024)
  ensure(large && oldBuffer !== module.HEAPF64.buffer, 'Element memory did not grow')
  try { same(calculate(module, prepared)); same(before) } finally { module._free(large) }
  const overflow = { elements: [[1e308, 0, 0, 0, 0]], factor: 1, scatteringTensors: [Array(18).fill(1e308)] }
  for (const request of [prepared, scalar, { elements: [], factor: 1, scatteringTensors: [] }, { elements: [], factor: 1 }]) {
    const allocationCount = (request.elements.length ? 1 : 0) + (request.scatteringTensors?.length ? 1 : 0) +
      1 + (request.scatteringTensors != null ? 1 : 0)
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
            ensure(outstanding.delete(pointer), 'Element invalid free'); target._free(pointer)
          }
          return target[key]
        },
      })
      failure(() => calculate(wrapped, request), error => /allocation failed/.test(error.message))
      ensure(outstanding.size === 0, 'Element allocation leaked')
      // All allocations now succeed; exercise an actual native late matrix overflow.
      failure(() => calculate(wrapped, overflow), error => error.status === 2)
      ensure(outstanding.size === 0, 'Element native error leaked')
      same(calculate(wrapped, prepared))
      ensure(outstanding.size === 0, 'Element recovery leaked')
    }
  }
  before.opticalConstants.fill(123); before.dielectricTensor.fill(123)
  same(calculate(module, prepared))
  return count
}
