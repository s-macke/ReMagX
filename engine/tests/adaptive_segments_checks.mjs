export function sampleAdaptiveSegments(module, calculate, request) {
  const states = Array.from({ length: 4 }, () => Array(18).fill(0))
  const result = calculate(module, { ...request, sample: (position, slot) => Array.from({ length: request.valueCount },
    (_, component) => {
      const value = ((component + 1) * 1e-7) * (position * position + .25 * position + 2)
      if (request.stateful && component >= 4) return states[slot][component - 4] += value
      return value
    }) })
  return Array.from(result.positions, (position, index) => [position, result.thicknesses[index],
    ...result.values.slice(index * request.valueCount, (index + 1) * request.valueCount)]).flat()
}

export function checkAdaptiveSegments(module, calculate) {
  const ensure = (condition, message) => { if (!condition) throw new Error(message) }
  const failure = (operation, predicate) => {
    try { operation() } catch (error) {
      ensure(predicate(error), `Unexpected adaptive failure: ${String(error)}`)
      return
    }
    throw new Error('Expected adaptive failure')
  }
  const request = { minimumDepth: 0, maximumDepth: 4, minimumStep: 1, maximumStep: 2,
    gradientScale: .2, capacity: 10, valueCount: 4, sample: () => new Float64Array([1, 2, 3, 4]) }
  const same = result => {
    ensure(JSON.stringify(Array.from(result.positions)) === '[1,3,5]', 'Adaptive positions mismatch')
    ensure(JSON.stringify(Array.from(result.thicknesses)) === '[0,2,2]', 'Adaptive thickness mismatch')
    ensure(JSON.stringify(Array.from(result.values)) === '[1,2,3,4,1,2,3,4,1,2,3,4]', 'Adaptive values mismatch')
  }
  const slots = []
  calculate(module, { ...request, sample: (_position, slot) => { slots.push(slot); return [1, 2, 3, 4] } })
  ensure(JSON.stringify(slots) === '[0,1,2,3,0,1,2,3,0,1,2,3,0,0]', 'Adaptive sample slots mismatch')
  const before = calculate(module, request), snapshot = JSON.stringify(request)
  same(before)
  for (const patch of [{ minimumDepth: NaN }, { maximumDepth: -1 }, { minimumStep: 0 },
    { maximumStep: .5 }, { gradientScale: Infinity }, { valueCount: 5 }, { capacity: 0 },
    { capacity: .5 }, { capacity: 1000001 }, { sample: null }]) {
    failure(() => calculate(module, { ...request, ...patch }), error => error instanceof TypeError)
  }
  for (const value of [[], new Array(4), [1, 2, 3, NaN], Promise.resolve([1, 2, 3, 4])]) {
    failure(() => calculate(module, { ...request, sample: () => value }), error => error instanceof TypeError)
  }
  failure(() => calculate(module, { ...request, capacity: 1 }), error => error.status === 1)
  failure(() => calculate(module, { ...request, minimumDepth: 1e20, maximumDepth: 1e20 }), error => error.status === 2)
  // Callback exceptions (including non-Error values) must survive native transport.
  for (const thrown of [new Error('sampler marker'), null, undefined]) {
    let calls = 0
    failure(() => calculate(module, { ...request, sample: () => {
      if (++calls === 13) throw thrown
      return [1, 2, 3, 4]
    } }), error => error === thrown)
  }
  let grew = false
  same(calculate(module, { ...request, sample: () => {
    if (!grew) {
      const buffer = module.HEAPF64.buffer, pointer = module._malloc(buffer.byteLength + 1024)
      ensure(pointer && buffer !== module.HEAPF64.buffer, 'Adaptive callback memory did not grow')
      module._free(pointer); grew = true
      // Nested calls use their own callback and buffers.
      same(calculate(module, request))
    }
    return [1, 2, 3, 4]
  } }))
  same(before)
  for (let failAt = 1; failAt <= 5; failAt++) {
    const allocations = new Set(), callbacks = new Set()
    let attempts = 0, registrationFailed = false
    const wrapped = new Proxy(module, { get(target, key) {
      if (key === '_malloc') return bytes => {
        if (++attempts === failAt) return 0
        const pointer = target._malloc(bytes); allocations.add(pointer); return pointer
      }
      if (key === '_free') return pointer => {
        ensure(allocations.delete(pointer), 'Adaptive invalid free'); target._free(pointer)
      }
      if (key === 'addFunction') return (...args) => {
        if (failAt === 5 && !registrationFailed) { registrationFailed = true; throw new Error('registration marker') }
        const pointer = target.addFunction(...args); callbacks.add(pointer); return pointer
      }
      if (key === 'removeFunction') return pointer => {
        ensure(callbacks.delete(pointer), 'Adaptive invalid callback removal'); target.removeFunction(pointer)
      }
      return target[key]
    } })
    failure(() => calculate(wrapped, request), error => /allocation failed|registration marker/.test(error.message))
    ensure(!allocations.size && !callbacks.size, 'Adaptive setup failure leaked')
    // Registration failed after four allocations; bypass the unused fifth allocation failure.
    attempts = 10
    failure(() => calculate(wrapped, { ...request, sample: () => { throw new Error('callback marker') } }),
      error => error.message === 'callback marker')
    ensure(!allocations.size && !callbacks.size, 'Adaptive callback failure leaked')
    failure(() => calculate(wrapped, { ...request, capacity: 1 }), error => error.status === 1)
    ensure(!allocations.size && !callbacks.size, 'Adaptive capacity failure leaked')
    same(calculate(wrapped, request))
    ensure(!allocations.size && !callbacks.size, 'Adaptive recovery leaked')
  }
  ensure(snapshot === JSON.stringify(request), 'Adaptive input changed')
  same(before)
}
