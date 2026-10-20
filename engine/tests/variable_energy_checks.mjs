// Shared Node/Chromium lifecycle checks for variable-count native scan storage.
export function checkVariableEnergy(module, calculate, cases) {
  const request = cases.find(item => item.mode === 1 && item.pointSettings && item.stacks.some(stack => stack.length !== item.stacks[0].length))
  if (!request) throw new Error('Missing variable energy-stack reference')
  const ensure = (value, message) => { if (!value) throw new Error(message) }
  const failure = (action, predicate) => {
    try { action() } catch (error) { ensure(predicate(error), 'Unexpected variable energy failure'); return }
    throw new Error('Expected variable energy failure')
  }
  const same = values => ensure(values.length === request.expected.length && Array.from(values).every((value, index) =>
    Number.isFinite(value) && Math.abs(value - request.expected[index]) <= 1e-15 + 1e-10 * Math.abs(request.expected[index])), 'Variable energy result mismatch')
  const snapshot = JSON.stringify(request)
  const retained = calculate(module, request)
  same(retained)
  const malformed = structuredClone(request)
  malformed.stacks[1] = malformed.stacks[1].slice(0, 1)
  failure(() => calculate(module, malformed), error => error instanceof TypeError)
  for (let failAt = 1; failAt <= 9; ++failAt) {
    let allocations = 0
    const outstanding = new Set()
    const wrapped = new Proxy(module, { get(target, key) {
      if (key === '_malloc') return bytes => {
        if (++allocations === failAt) return 0
        const pointer = target._malloc(bytes); outstanding.add(pointer); return pointer
      }
      if (key === '_free') return pointer => {
        ensure(outstanding.delete(pointer), 'Invalid energy buffer free'); target._free(pointer)
      }
      return target[key]
    } })
    failure(() => calculate(wrapped, request), error => /allocation failed/.test(error.message))
    ensure(outstanding.size === 0, 'Variable energy allocation leaked')
    const invalid = { ...request, qz: request.qz.map((value, index) => index === request.qz.length - 1 ? 1e10 : value) }
    failure(() => calculate(wrapped, invalid), error => error.status === 4)
    ensure(outstanding.size === 0, 'Variable energy numerical failure leaked')
    same(calculate(wrapped, request))
    ensure(outstanding.size === 0, 'Variable energy recovery leaked')
  }
  same(retained)
  ensure(JSON.stringify(request) === snapshot, 'Variable energy input changed')
}
