export function checkFitErrors(module, calculate, cases) {
  const check = (condition, message) => { if (!condition) throw new Error(`Fit error: ${message}`) }
  const close = (value, expected) => Number.isFinite(value) && Math.abs(value - expected) <= 1e-15 + 1e-10 * Math.abs(expected)
  const throws = (run, match) => {
    let threw = false
    try { run() } catch (error) { threw = true; check(match(error), 'unexpected exception') }
    check(threw, 'missing exception')
  }
  let values = 0
  for (const request of cases) {
    const before = JSON.stringify(request)
    const result = calculate(module, request)
    check(result.accepted === request.expected.accepted, 'accepted rows differ')
    check(close(result.error, request.expected.error), 'native mean mismatch')
    check(result.residuals.length === request.expected.residuals.length, 'residual dimensions')
    result.residuals.forEach((value, i) => check(close(value, request.expected.residuals[i]), 'native residual mismatch'))
    check(JSON.stringify(request) === before, 'input mutation')
    check(result.residuals.buffer !== module.HEAPF64.buffer, 'borrowed result')
    values += result.residuals.length + 1
  }
  const request = { mode: 3, qz: [0, .5], measured: [1, 10], calculated: [10, 1],
    measuredSecond: [1, 10], calculatedSecond: [10, 1], residuals: [23.5, 23.5], qzMin: 0, qzMax: .5 }
  const expected = calculate(module, request)
  check(expected.error === 2 && expected.accepted === 2 && expected.residuals.every(value => value === 2), 'beam normalization')
  for (const mode of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const empty = calculate(module, { mode, qz: [], energy: [], measured: [], calculated: [],
      measuredSecond: [], calculatedSecond: [], residuals: [], qzMin: 0, qzMax: 1 })
    check(empty.error === 0 && empty.accepted === 0 && empty.residuals.length === 0, 'empty selection')
  }
  check(calculate(module, { ...request, residuals: null }).residuals === null, 'optional residuals')
  const typed = Object.fromEntries(Object.entries(request).map(([key, value]) => [key, Array.isArray(value) ? new Float64Array(value) : value]))
  check(calculate(module, typed).error === expected.error, 'typed input')
  for (const change of [{ mode: 8 }, { qz: new Array(2) }, { measured: [1, Infinity] }, { calculated: [] },
    { measuredSecond: null }, { residuals: new Array(2) }, { qzMin: NaN }, { mode: 4, energy: null }]) {
    throws(() => calculate(module, { ...request, ...change }), error => error instanceof TypeError)
  }
  const overflow = { ...request, mode: 1, measured: [1, 1e308] }
  throws(() => calculate(module, overflow), error => error.status === 2)
  // Force heap growth between wrapper allocations, before any data is packed.
  const tracked = Object.create(module), allocated = new Set()
  let allocation = 0, grew = false
  tracked._malloc = bytes => {
    if (allocation++ === 1) {
      const previous = module.HEAPF64.buffer
      const block = module._malloc(previous.byteLength + 65536)
      check(block && previous !== module.HEAPF64.buffer, 'heap growth')
      module._free(block)
      grew = true
    }
    const pointer = module._malloc(bytes)
    if (pointer) allocated.add(pointer)
    return pointer
  }
  tracked._free = pointer => { check(allocated.delete(pointer), 'unexpected free'); module._free(pointer) }
  check(calculate(tracked, request).error === expected.error && grew && allocated.size === 0, 'growth recovery')
  for (let failure = 0; failure < 8; failure++) {
    allocation = 0
    tracked._malloc = bytes => {
      if (allocation++ === failure) return 0
      const pointer = module._malloc(bytes); if (pointer) allocated.add(pointer); return pointer
    }
    throws(() => calculate(tracked, request), error => /allocation/.test(error.message))
    check(allocated.size === 0, 'partial allocation leak')
  }
  tracked._malloc = bytes => { const pointer = module._malloc(bytes); if (pointer) allocated.add(pointer); return pointer }
  throws(() => calculate(tracked, overflow), error => error.status === 2)
  check(allocated.size === 0 && calculate(tracked, request).error === expected.error && allocated.size === 0, 'error cleanup/recovery')
  return values
}
