// Synchronous prepared-simplex optimizer. Invoke in a worker, never on the UI thread.
// A running call cannot process worker messages; service Stop still needs its
// termination fallback unless a synchronously readable stop flag is supplied.
// Objective/progress receive owned copies. Callbacks may call other core APIs or
// grow memory; no heap views survive a callback. Project objectives/bounds are separate.
function minimize(module, {
  simplex, objective, shouldStop = () => false, onProgress = () => {},
  maxEvaluations = 10000, maxIterations = 5000,
  parameterTolerance = 1e-9, objectiveTolerance = 1e-14,
}, annealing) {
  const dimension = simplex?.[0]?.length
  const unsigned = value => Number.isInteger(value) && value > 0 && value <= 0xffffffff
  if (!Array.isArray(simplex) || !unsigned(dimension) || simplex.length !== dimension + 1 ||
      !Array.from(simplex).every(row => Array.isArray(row) && row.length === dimension &&
        Array.from(row).every(Number.isFinite)) || typeof objective !== 'function' ||
      typeof shouldStop !== 'function' || typeof onProgress !== 'function' ||
      !unsigned(maxEvaluations) || maxEvaluations < dimension + 1 || !unsigned(maxIterations) ||
      !Number.isFinite(parameterTolerance) || parameterTolerance < 0 ||
      !Number.isFinite(objectiveTolerance) || objectiveTolerance < 0) {
    throw new TypeError('Invalid simplex optimizer input')
  }
  const allocations = [], callbacks = []
  let callbackFailed = false, callbackError
  const rememberError = error => { if (!callbackFailed) { callbackFailed = true; callbackError = error } }
  const allocate = bytes => {
    if (!Number.isSafeInteger(bytes) || bytes > 0x7fffffff) throw new RangeError('Optimizer buffer too large')
    const pointer = module._malloc(bytes)
    if (!pointer) throw new Error('Optimizer allocation failed')
    allocations.push(pointer)
    return pointer
  }
  const register = (callback, signature) => {
    const pointer = module.addFunction(callback, signature)
    callbacks.push(pointer)
    return pointer
  }
  try {
    const initial = allocate(simplex.length * dimension * 8)
    const optionsSize = annealing ? 48 : 24
    const options = allocate(optionsSize), best = allocate(dimension * 8), summary = allocate(24)
    module.HEAPF64.set(simplex.flat(), initial / 8)
    const settings = new DataView(module.HEAPF64.buffer, options, optionsSize)
    settings.setUint32(0, maxEvaluations, true)
    settings.setUint32(4, maxIterations, true)
    settings.setFloat64(8, parameterTolerance, true)
    settings.setFloat64(16, objectiveTolerance, true)
    if (annealing) {
      settings.setFloat64(24, annealing.temperature, true)
      settings.setFloat64(32, annealing.temperatureStep, true)
      settings.setUint32(40, annealing.seed, true)
    }
    const evaluate = register((parameters, count, _context, output) => {
      try {
        const value = objective(module.HEAPF64.slice(parameters / 8, parameters / 8 + count))
        if (!Number.isFinite(value)) throw new TypeError('Objective must return a finite number synchronously')
        module.HEAPF64[output / 8] = value
        return 0
      } catch (error) { rememberError(error); return 1 }
    }, 'iiiii')
    const stop = register(() => {
      if (callbackFailed) return 1
      try {
        const requested = shouldStop()
        if (typeof requested !== 'boolean') throw new TypeError('Stop callback must return a boolean synchronously')
        return Number(requested)
      } catch (error) { rememberError(error); return 1 }
    }, 'ii')
    const progress = register((parameters, count, value, iterations, evaluations) => {
      try {
        const result = onProgress({ parameters: module.HEAPF64.slice(parameters / 8, parameters / 8 + count),
          value, iterations, evaluations })
        if (result && typeof result.then === 'function') throw new TypeError('Progress callback must be synchronous')
      } catch (error) { rememberError(error) }
    }, 'viidiii')
    const invoke = annealing ? module._remagx_simplex_annealing : module._remagx_nelder_mead
    const status = invoke(initial, dimension, options, evaluate, stop, progress, 0, best, summary)
    if (callbackFailed) throw callbackError
    if (status !== 0) {
      const error = new Error(`Simplex optimizer failed (status ${status})`)
      error.status = status
      throw error
    }
    const result = new DataView(module.HEAPF64.buffer, summary, 24)
    const hasBest = Boolean(result.getInt32(4, true))
    return { termination: ['converged', 'evaluation-limit', 'iteration-limit', 'stopped'][result.getInt32(0, true)],
      parameters: hasBest ? module.HEAPF64.slice(best / 8, best / 8 + dimension) : null,
      value: hasBest ? result.getFloat64(16, true) : null,
      iterations: result.getUint32(8, true), evaluations: result.getUint32(12, true) }
  } finally {
    for (const callback of callbacks) module.removeFunction(callback)
    for (const pointer of allocations) module._free(pointer)
  }
}

export function minimizeSimplex(module, request) {
  return minimize(module, request)
}

// Explicit settings avoid an implicit temperature schedule or random seed.
export function minimizeAnnealing(module, request) {
  const { temperature, temperatureStep, seed } = request
  if (!Number.isFinite(temperature) || temperature < 0 || !Number.isFinite(temperatureStep) ||
      !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new TypeError('Invalid annealing temperature, step or seed')
  }
  return minimize(module, request, { temperature, temperatureStep, seed })
}
