export function sampleSegmentedOptics(module, calculate, request) {
  let state = request.tensorState
  const values = []
  for (const position of request.positions) {
    const result = calculate(module, { ...request, position, tensorState: state })
    values.push(...result.opticalConstants, ...result.dielectricTensor)
    state = result.dielectricTensor
  }
  return values
}

export function checkSegmentedOptics(module, calculate, subdivide) {
  const ensure = (condition, message) => { if (!condition) throw new Error(message) }
  const failure = (operation, predicate) => {
    try { operation() } catch (error) {
      ensure(predicate(error), `Unexpected segmented optical failure: ${error}`)
      return
    }
    throw new Error('Expected segmented optical failure')
  }
  const request = { layers: [[0, 1, 2, 4, 6, 8, 90, 90], [100, 1, 4, 6, 8, 10, 90, 90]],
    boundaries: [0, 100], tensors: [Array(18).fill(2), Array(18).fill(4)], tensorState: Array(18).fill(7),
    model: 2, position: 0, errorSamples: Array(1001).fill(0) }
  const scalar = result => ensure(JSON.stringify(Array.from(result.opticalConstants)) === '[3,5,7,9]', 'Segmented scalar mismatch')
  const same = result => { scalar(result); ensure(result.dielectricTensor.every(value => value === 10), 'Segmented tensor mismatch') }
  const snapshot = JSON.stringify(request), before = calculate(module, request)
  same(before)
  const again = calculate(module, { ...request, tensorState: before.dielectricTensor })
  scalar(again); ensure(again.dielectricTensor.every(value => value === 13), 'Local tensor state did not accumulate')
  for (const model of [0, 1]) {
    const result = calculate(module, { ...request, model })
    scalar(result); ensure(result.dielectricTensor.every(value => value === 3), 'Global tensor was not replaced')
  }
  const zero = calculate(module, { ...request, model: 0, boundaries: [0, 0], position: 100 })
  ensure(zero.opticalConstants.every(value => value === 0) && zero.dielectricTensor.every(value => value === 7), 'Zero-weight state mismatch')
  scalar(calculate(module, { ...request, tensors: null, tensorState: null, boundaries: null }))
  ensure(calculate(module, { ...request, tensorState: null }).dielectricTensor.every(value => value === 3), 'Default tensor state mismatch')
  for (const patch of [{ layers: [] }, { layers: new Array(2) }, { layers: [new Array(8), request.layers[1]] },
    { layers: [[0, -1, 2, 4, 6, 8, 90, 90], request.layers[1]] }, { boundaries: [0] },
    { boundaries: null, model: 0 }, { tensors: new Array(2) }, { tensors: [[1], [2]] },
    { tensorState: new Array(18) }, { tensorState: [1] }, { tensors: null },
    { model: 3 }, { position: NaN }, { errorSamples: undefined }, { errorSamples: Array(1000).fill(0) },
    { errorSamples: new Array(1001) }]) {
    failure(() => calculate(module, { ...request, ...patch }), error => error instanceof TypeError)
  }
  // Compose the two actual WASM APIs. Constant synthetic lookup isolates state
  // retention: final resampling continues slot 0 after its three earlier calls.
  for (const model of [0, 1, 2]) {
    const states = [null, null, null, null]
    const result = subdivide(module, { minimumDepth: 0, maximumDepth: 4,
      minimumStep: 1, maximumStep: 2, gradientScale: .2, valueCount: 22, capacity: 10,
      sample: (position, slot) => {
        const sampled = calculate(module, { ...request, model, position, tensorState: states[slot] })
        states[slot] = sampled.dielectricTensor
        return [...sampled.opticalConstants, ...sampled.dielectricTensor]
      } })
    ensure(JSON.stringify(Array.from(result.positions)) === '[1,3,5]', 'Composed segmentation positions mismatch')
    for (let index = 0; index < 3; ++index) {
      const values = result.values.slice(index * 22, (index + 1) * 22)
      ensure(JSON.stringify(Array.from(values.slice(0, 4))) === '[3,5,7,9]', 'Composed segmentation scalars mismatch')
      ensure(values.slice(4).every(value => value === (model === 2 ? [3, 12, 15][index] : 3)), 'Composed sampling state mismatch')
    }
  }
  const oldBuffer = module.HEAPF64.buffer, large = module._malloc(oldBuffer.byteLength + 1024)
  ensure(large && oldBuffer !== module.HEAPF64.buffer, 'Segmented optics memory did not grow')
  try { same(calculate(module, request)); same(before) } finally { module._free(large) }
  for (const variant of [request, { ...request, tensors: null, tensorState: null, boundaries: null }]) {
    const expectedAllocations = variant.tensors === null ? 3 : 6
    for (let failAt = 1; failAt <= expectedAllocations; ++failAt) {
      let attempts = 0
      const outstanding = new Set()
      const wrapped = new Proxy(module, { get(target, key) {
        if (key === '_malloc') return bytes => {
          if (++attempts === failAt) return 0
          const pointer = target._malloc(bytes); outstanding.add(pointer); return pointer
        }
        if (key === '_free') return pointer => {
          ensure(outstanding.delete(pointer), 'Segmented optics invalid free'); target._free(pointer)
        }
        return target[key]
      } })
      failure(() => calculate(wrapped, variant), error => /allocation failed/.test(error.message))
      ensure(!outstanding.size, 'Segmented optics allocation failure leaked')
      const overflow = variant.tensors ? { ...variant, tensors: [Array(18).fill(1e308), Array(18).fill(-1e308)] }
        : { ...variant, layers: [[0, 1, 1e308, 0, 0, 0, 90, 90], [0, 1, -1e308, 0, 0, 0, 90, 90]] }
      failure(() => calculate(wrapped, overflow), error => error.status === 2)
      ensure(!outstanding.size, 'Segmented optics numerical failure leaked')
      scalar(calculate(wrapped, variant))
      ensure(!outstanding.size, 'Segmented optics recovery leaked')
    }
  }
  ensure(snapshot === JSON.stringify(request), 'Segmented optics input changed')
  same(before)
}
