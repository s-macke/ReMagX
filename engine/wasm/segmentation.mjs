// Synchronous subdivision: call from a compute worker. Optical sampling policy
// and project range/classification preparation belong to the caller.
// sample(position, slot) receives the original reusable sampling-object index
// (0..3); final midpoint resampling reuses slot 0. Keep any tensor state per slot.
export function calculateAdaptiveSegments(module, {
  minimumDepth, maximumDepth, minimumStep, maximumStep, gradientScale,
  valueCount = 4, capacity = 100000, sample,
}) {
  if (![minimumDepth, maximumDepth, minimumStep, maximumStep, gradientScale].every(Number.isFinite) ||
      minimumDepth > maximumDepth || minimumStep <= 0 || maximumStep < minimumStep ||
      ![4, 22].includes(valueCount) || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000000 ||
      typeof sample !== 'function') throw new TypeError('Invalid adaptive segmentation input')
  const allocations = []
  let callback, callbackFailed = false, callbackError
  const allocate = count => {
    const pointer = module._malloc(count * 8)
    if (!pointer) throw new Error('Adaptive segmentation allocation failed')
    allocations.push(pointer)
    return pointer
  }
  try {
    const positions = allocate(capacity), thicknesses = allocate(capacity)
    const values = allocate(capacity * valueCount), count = allocate(1)
    callback = module.addFunction((position, slot, output, _context) => {
      try {
        const result = sample(position, slot)
        if ((!Array.isArray(result) && !(result instanceof Float64Array)) || result.length !== valueCount) {
          throw new TypeError('Optical sampler must return a finite vector synchronously')
        }
        for (const value of result) if (!Number.isFinite(value)) throw new TypeError('Optical sampler must return finite values')
        // Sampling may call other WASM routines or grow memory. Refresh the heap.
        module.HEAPF64.set(result, output / 8)
        return 0
      } catch (error) { callbackFailed = true; callbackError = error; return 1 }
    }, 'idiii')
    const status = module._remagx_adaptive_segments(minimumDepth, maximumDepth, minimumStep,
      maximumStep, gradientScale, valueCount, callback, 0, capacity, positions, thicknesses, values, count)
    if (callbackFailed) throw callbackError
    if (status !== 0) {
      const error = new Error(`Adaptive segmentation failed (status ${status})`)
      error.status = status
      throw error
    }
    const length = new DataView(module.HEAPF64.buffer, count, 4).getUint32(0, true)
    if (length < 1 || length > capacity) throw new Error('Invalid adaptive segment count')
    return { positions: module.HEAPF64.slice(positions / 8, positions / 8 + length),
      thicknesses: module.HEAPF64.slice(thicknesses / 8, thicknesses / 8 + length),
      values: module.HEAPF64.slice(values / 8, values / 8 + length * valueCount) }
  } finally {
    if (callback !== undefined) module.removeFunction(callback)
    for (const pointer of allocations) module._free(pointer)
  }
}

// One depth sample. Caller retains the returned tensor separately for each
// sampling slot; neither the supplied tensor state nor the input stack is edited.
export function calculateSegmentedOptics(module, {
  layers, boundaries = null, tensors = null, tensorState = null, model, position, errorSamples,
}) {
  const vector = (value, length) => (Array.isArray(value) || value instanceof Float64Array) &&
    value.length === length && Array.from(value).every(Number.isFinite)
  const rows = (value, length, width) => Array.isArray(value) && value.length === length &&
    Array.from(value).every(row => vector(row, width))
  if (!Array.isArray(layers) || layers.length < 2 || !rows(layers, layers.length, 8) ||
      layers.some(row => row[0] < 0 || row[1] < 0) || ![0, 1, 2].includes(model) || !Number.isFinite(position) ||
      !vector(errorSamples, 1001) || (model === 0 && boundaries === null) ||
      (boundaries !== null && !vector(boundaries, layers.length)) ||
      (tensors !== null && !rows(tensors, layers.length, 18)) ||
      (tensorState !== null && (tensors === null || !vector(tensorState, 18)))) {
    throw new TypeError('Invalid segmented optical input')
  }
  const allocations = []
  const allocate = count => {
    const bytes = count * 8
    if (!Number.isSafeInteger(bytes) || bytes > 0x7fffffff) throw new RangeError('Segmented optical buffer too large')
    const pointer = module._malloc(bytes)
    if (!pointer) throw new Error('Segmented optical allocation failed')
    allocations.push(pointer)
    return pointer
  }
  try {
    const stack = allocate(layers.length * 8)
    const boundary = boundaries === null ? 0 : allocate(layers.length)
    const tensor = tensors === null ? 0 : allocate(layers.length * 18)
    const table = allocate(1001), output = allocate(4), state = tensors === null ? 0 : allocate(18)
    module.HEAPF64.set(layers.flatMap(row => Array.from(row)), stack / 8)
    if (boundary) module.HEAPF64.set(boundaries, boundary / 8)
    if (tensor) module.HEAPF64.set(tensors.flatMap(row => Array.from(row)), tensor / 8)
    module.HEAPF64.set(errorSamples, table / 8)
    if (state) module.HEAPF64.set(tensorState ?? new Float64Array(18), state / 8)
    const status = module._remagx_segmented_optics(stack, layers.length, boundary, tensor, model,
      position, table, 1001, output, state)
    if (status !== 0) {
      const error = new Error(`Segmented optical sampling failed (status ${status})`)
      error.status = status
      throw error
    }
    return { opticalConstants: module.HEAPF64.slice(output / 8, output / 8 + 4),
      dielectricTensor: state ? module.HEAPF64.slice(state / 8, state / 8 + 18) : null }
  } finally {
    for (const pointer of allocations) module._free(pointer)
  }
}
