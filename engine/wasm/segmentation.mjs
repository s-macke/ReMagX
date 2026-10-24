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
    if (!pointer) throw Object.assign(new Error('Adaptive segmentation allocation failed'), { status: 3 })
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

// Prepared immutable inputs are copied once. Tensor state remains caller-owned,
// separately for each adaptive sampling slot; every sample returns owned arrays.
export function createSegmentedOpticalSampler(module, request) {
  return opticalSampler(module, request, true)
}

function opticalSampler(module, {
  layers, boundaries = null, tensors = null, model, errorSamples,
}, prepareNative) {
  const rows = (value, length, width) => Array.isArray(value) && value.length === length &&
    Array.from(value).every(row => opticalVector(row, width))
  if (!Array.isArray(layers) || layers.length < 2 || !rows(layers, layers.length, 8) ||
      layers.some(row => row[0] < 0 || row[1] < 0) || ![0, 1, 2].includes(model) ||
      !opticalVector(errorSamples, 1001) || (model === 0 && boundaries === null) ||
      (boundaries !== null && !opticalVector(boundaries, layers.length)) ||
      (tensors !== null && !rows(tensors, layers.length, 18))) {
    throw new TypeError('Invalid segmented optical input')
  }
  const allocations = []
  let disposed = false, prepared = 0
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (prepared) module._remagx_segmented_optics_destroy(prepared)
    for (const pointer of allocations) module._free(pointer)
  }
  const allocate = count => {
    const bytes = count * 8
    if (!Number.isSafeInteger(bytes) || bytes > 0x7fffffff) throw new RangeError('Segmented optical buffer too large')
    const pointer = module._malloc(bytes)
    if (!pointer) throw Object.assign(new Error('Segmented optical allocation failed'), { status: 3 })
    allocations.push(pointer)
    return pointer
  }
  try {
    const layerCount = layers.length
    const stack = allocate(layerCount * 8)
    const boundary = boundaries === null ? 0 : allocate(layerCount)
    const tensor = tensors === null ? 0 : allocate(layerCount * 18)
    const table = allocate(1001), output = allocate(4), state = tensors === null ? 0 : allocate(18)
    module.HEAPF64.set(layers.flatMap(row => Array.from(row)), stack / 8)
    if (boundary) module.HEAPF64.set(boundaries, boundary / 8)
    if (tensor) module.HEAPF64.set(tensors.flatMap(row => Array.from(row)), tensor / 8)
    module.HEAPF64.set(errorSamples, table / 8)
    if (prepareNative) {
      // The native constructor copies immutable inputs. Reuse the output buffer
      // for the returned wasm32 handle, then release the temporary input buffers.
      const status = module._remagx_segmented_optics_prepare(stack, layerCount, boundary, tensor,
        model, table, 1001, output)
      if (status !== 0) {
        const error = new Error(`Segmented optical preparation failed (status ${status})`)
        error.status = status
        throw error
      }
      prepared = new DataView(module.HEAPF64.buffer, output, 4).getUint32(0, true)
      if (!prepared) throw new Error('Invalid prepared optical handle')
      for (const pointer of [stack, boundary, tensor, table]) if (pointer) {
        allocations.splice(allocations.indexOf(pointer), 1)
        module._free(pointer)
      }
    }
    return {
      sample(position, tensorState = null) {
        if (disposed) throw new Error('Segmented optical sampler is disposed')
        validateOpticalSample(position, tensorState, !!state)
        // Other WASM calls, including subdivision, may have grown memory.
        if (state) {
          if (tensorState === null) module.HEAPF64.fill(0, state / 8, state / 8 + 18)
          else module.HEAPF64.set(tensorState, state / 8)
        }
        const status = prepared ? module._remagx_segmented_optics_sample(prepared, position, output, state)
          : module._remagx_segmented_optics(stack, layerCount, boundary, tensor, model,
            position, table, 1001, output, state)
        if (status !== 0) {
          const error = new Error(`Segmented optical sampling failed (status ${status})`)
          error.status = status
          throw error
        }
        return { opticalConstants: module.HEAPF64.slice(output / 8, output / 8 + 4),
          dielectricTensor: state ? module.HEAPF64.slice(state / 8, state / 8 + 18) : null }
      }, dispose,
    }
  } catch (error) { dispose(); throw error }
}

function opticalVector(value, length) {
  return (Array.isArray(value) || value instanceof Float64Array) &&
    value.length === length && Array.from(value).every(Number.isFinite)
}
function validateOpticalSample(position, tensorState, hasTensors) {
  if (!Number.isFinite(position) || (tensorState !== null && (!hasTensors || !opticalVector(tensorState, 18)))) {
    throw new TypeError('Invalid segmented optical input')
  }
}

// Compatibility entry point for one sample, with the same validation/ownership.
export function calculateSegmentedOptics(module, request) {
  const { position, tensorState = null, tensors = null } = request
  validateOpticalSample(position, tensorState, tensors !== null)
  const sampler = opticalSampler(module, request, false)
  try { return sampler.sample(position, tensorState) } finally { sampler.dispose() }
}
