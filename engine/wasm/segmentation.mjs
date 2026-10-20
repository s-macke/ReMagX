// Synchronous subdivision: call from a compute worker. Optical sampling policy
// and project range/classification preparation belong to the caller.
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
    callback = module.addFunction((position, output, _context) => {
      try {
        const result = sample(position)
        if ((!Array.isArray(result) && !(result instanceof Float64Array)) || result.length !== valueCount) {
          throw new TypeError('Optical sampler must return a finite vector synchronously')
        }
        for (const value of result) if (!Number.isFinite(value)) throw new TypeError('Optical sampler must return finite values')
        // Sampling may call other WASM routines or grow memory. Refresh the heap.
        module.HEAPF64.set(result, output / 8)
        return 0
      } catch (error) { callbackFailed = true; callbackError = error; return 1 }
    }, 'idii')
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
