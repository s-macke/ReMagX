// Shared checks run against actual WASM in Node and a Chromium module worker.
export function checkOptimizer(module, minimize, cases, calculateParratt, calculateFitError, minimizeAnnealing) {
  const check = (condition, message) => { if (!condition) throw new Error(`Optimizer: ${message}`) }
  const close = (value, target) => Number.isFinite(value) && Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target)
  const expectThrow = (run, matches) => {
    let thrown = false
    try { run() } catch (error) { thrown = true; check(matches(error), 'wrong exception') }
    check(thrown, 'missing exception')
  }
  const objectiveFor = kind => point => {
    if (kind === 'flat') return 1
    if (kind === 'double-well') {
      const squared = point[0] * point[0] - 4
      return squared * squared + .3 * point[0]
    }
    if (kind === 'rosenbrock') {
      const curved = point[1] - point[0] * point[0]
      return 100 * curved * curved + (1 - point[0]) * (1 - point[0])
    }
    let sum = 0
    for (let i = 0; i < point.length; i++) {
      const offset = point[i] - (i + 1)
      sum += (i + 1) * offset * offset
    }
    return sum
  }
  for (const item of cases) {
    const snapshot = JSON.stringify(item.simplex)
    let lastValue = Infinity, progressCount = 0, evaluations = 0
    const invoke = item.annealing ? minimizeAnnealing : minimize
    const result = invoke(module, { ...item, objective: point => {
      evaluations++
      const value = objectiveFor(item.kind)(point)
      point.fill(123) // Callback copies must not corrupt the native simplex.
      return value
    }, onProgress: progress => {
      check(progress.value <= lastValue && progress.iterations === progressCount++, 'progress ordering')
      check(progress.evaluations === evaluations, 'progress evaluation count')
      lastValue = progress.value
      progress.parameters.fill(123)
    } })
    check(JSON.stringify(item.simplex) === snapshot, 'input mutation')
    const expected = item.expected
    check(result.termination === expected.termination && result.iterations === expected.iterations &&
      result.evaluations === expected.evaluations, 'native termination/counters mismatch')
    check(close(result.value, expected.value), 'native objective mismatch')
    check(result.parameters.length === expected.parameters.length &&
      result.parameters.every((value, i) => close(value, expected.parameters[i])), 'native parameters mismatch')
  }
  const points = Array.from({ length: 40 }, (_, i) => [.02 + .004 * i, 2 * Math.PI * 640 / 12398.326, 0])
  const curve = thickness => calculateParratt(module, {
    layers: [[0, 2, .01, .002, 0, 0, 0, 0], [thickness, 1, .006, .001, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]],
    points, beam: [1, 0, 0, 0],
  })
  const target = curve(35)
  const recovered = minimize(module, { simplex: [[30], [40]], objective: parameters => {
    const calculated = curve(parameters[0])
    return calculateFitError(module, { mode: 0, qz: points.map(point => 2 * point[1] * Math.sin(point[0])),
      measured: target, calculated, qzMin: 0, qzMax: 1 }).error
  } })
  check(recovered.termination === 'converged' && recovered.value < 1e-16 &&
    Math.abs(recovered.parameters[0] - 35) < 1e-7, 'nested WASM reflectivity recovery')
  const request = { simplex: [[0], [2]], objective: point => (point[0] + 4) * (point[0] + 4) }
  for (const limit of [0, 1, 3, 5]) {
    let evaluations = 0
    const result = minimize(module, { ...request, objective: point => { evaluations++; return request.objective(point) },
      shouldStop: () => evaluations >= limit })
    check(result.termination === 'stopped' && result.evaluations === limit, 'stop count')
    if (!limit) check(result.parameters === null && result.value === null, 'stop before objective')
    if (limit === 3) check(result.parameters[0] === -2 && result.iterations === 0, 'lost incomplete trial')
  }
  for (const change of [{ simplex: [] }, { simplex: [[0], ,] }, { simplex: [[0], [NaN]] },
    { maxEvaluations: 1 }, { maxIterations: 2 ** 32 }, { parameterTolerance: -1 }, { objective: null }]) {
    expectThrow(() => minimize(module, { ...request, ...change }), error => error instanceof TypeError)
  }
  for (const value of [NaN, Infinity, Promise.resolve(1)])
    expectThrow(() => minimize(module, { ...request, objective: () => value }), error => error instanceof TypeError)
  expectThrow(() => minimize(module, { ...request, shouldStop: () => 1 }), error => error instanceof TypeError)
  for (const callback of ['objective', 'shouldStop', 'onProgress']) {
    const sentinel = new Error(`Failure in ${callback}`)
    expectThrow(() => minimize(module, { ...request, [callback]: () => { throw sentinel } }), error => error === sentinel)
  }
  expectThrow(() => minimize(module, { ...request, objective: () => { throw undefined } }), error => error === undefined)
  expectThrow(() => minimize(module, { ...request, simplex: [[-1e308], [1e308]], objective: point => point[0] > 0 ? 2 : 1 }),
    error => error.status === 2)
  // Grow actual WASM memory from inside the objective; the wrapper must refresh its views.
  let grew = false
  const grown = minimize(module, { ...request, objective: point => {
    if (!grew) {
      const previous = module.HEAPF64.buffer
      const block = module._malloc(previous.byteLength + 65536)
      check(block !== 0 && previous !== module.HEAPF64.buffer, 'memory did not grow')
      module._free(block)
      grew = true
    }
    return request.objective(point)
  } })
  check(grown.value < 1e-16 && Math.abs(grown.parameters[0] + 4) < 1e-8, 'growth recovery')
  // Track both wrapper-owned buffers and callback table entries on every exit path.
  const allocated = new Set(), registered = new Set()
  const tracked = Object.create(module)
  tracked._malloc = bytes => { const pointer = module._malloc(bytes); if (pointer) allocated.add(pointer); return pointer }
  tracked._free = pointer => { check(allocated.delete(pointer), 'unexpected free'); module._free(pointer) }
  tracked.addFunction = (callback, signature) => { const pointer = module.addFunction(callback, signature); registered.add(pointer); return pointer }
  tracked.removeFunction = pointer => { check(registered.delete(pointer), 'unexpected function removal'); module.removeFunction(pointer) }
  const clean = () => check(allocated.size === 0 && registered.size === 0, 'resource leak')
  for (let failure = 0; failure < 4; failure++) {
    let calls = 0
    tracked._malloc = bytes => { if (calls++ === failure) return 0; const pointer = module._malloc(bytes); allocated.add(pointer); return pointer }
    expectThrow(() => minimize(tracked, request), error => /allocation/.test(error.message))
    clean()
  }
  tracked._malloc = bytes => { const pointer = module._malloc(bytes); allocated.add(pointer); return pointer }
  for (let failure = 0; failure < 3; failure++) {
    let calls = 0
    tracked.addFunction = (callback, signature) => {
      if (calls++ === failure) throw new Error('Injected registration failure')
      const pointer = module.addFunction(callback, signature); registered.add(pointer); return pointer
    }
    expectThrow(() => minimize(tracked, request), error => /registration/.test(error.message))
    clean()
  }
  tracked.addFunction = (callback, signature) => { const pointer = module.addFunction(callback, signature); registered.add(pointer); return pointer }
  for (const callback of ['objective', 'shouldStop', 'onProgress']) {
    expectThrow(() => minimize(tracked, { ...request, [callback]: () => { throw new Error('Injected callback failure') } }),
      error => /callback/.test(error.message))
    clean()
  }
  for (let repeat = 0; repeat < 5; repeat++) { minimize(tracked, request); clean() }
  check(grown.parameters[0] !== 123, 'output independence')
  if (minimizeAnnealing) {
    const events = []
    const referenceRequest = { simplex: [[0], [1]], maxIterations: 2, objective: point => (point[0] - 4) ** 2 }
    const observed = minimize(tracked, { ...referenceRequest, onReference: event => {
      events.push({ ...event, parameters: Array.from(event.parameters) })
      event.parameters.fill(123)
      if (events.length === 1) {
        const pointer = module._malloc(module.HEAPF64.buffer.byteLength + 65536)
        check(Boolean(pointer), 'reference memory growth allocation'); module._free(pointer)
      }
    } })
    clean()
    check(JSON.stringify(events.map(event => [event.phase, event.parameters[0], event.iterations, event.evaluations])) ===
      JSON.stringify([['selected', 1, 0, 2], ['completed', 1, 1, 4], ['selected', 3, 1, 4], ['completed', 3, 2, 6]]),
      'reference lifecycle differs from native')
    check(observed.parameters[0] === 4 && observed.evaluations === 6, 'reference copy/growth changed result')
    for (const phase of ['selected', 'completed']) {
      expectThrow(() => minimize(tracked, { ...referenceRequest, onReference: event => {
        if (event.phase === phase) throw new Error('Reference failure')
      } }), error => error.message === 'Reference failure')
      clean()
    }
    expectThrow(() => minimize(tracked, { ...referenceRequest, onReference: () => Promise.resolve() }), error => /synchronous/.test(error.message))
    clean()
    let stopped = false, referenceEvents = 0
    const cancelled = minimize(tracked, { ...referenceRequest, shouldStop: () => stopped, onReference: () => { stopped = true; referenceEvents++ } })
    check(cancelled.termination === 'stopped' && cancelled.evaluations === 2 && referenceEvents === 1, 'reference Stop ordering')
    clean()
    expectThrow(() => minimizeAnnealing(tracked, { ...referenceRequest, temperature: 0, temperatureStep: 0, seed: 1,
      onReference: () => {} }), error => error instanceof TypeError)
    clean()
    const cold = { temperature: 0, temperatureStep: 0, seed: 0 }
    for (const change of [{ temperature: -1 }, { temperature: Infinity }, { temperatureStep: NaN },
      { seed: -1 }, { seed: 2 ** 32 }, { seed: .5 }, { seed: undefined }]) {
      expectThrow(() => minimizeAnnealing(module, { ...request, ...cold, ...change }), error => error instanceof TypeError)
    }
    expectThrow(() => minimizeAnnealing(tracked, { ...request, ...cold,
      temperature: Number.MAX_VALUE, seed: 1, objective: () => Number.MAX_VALUE }), error => error.status === 2)
    clean()
    for (let seed = 0; seed < 12; seed++) {
      const visited = []
      const result = minimizeAnnealing(module, { simplex: [[0], [1]], temperature: 1, temperatureStep: -.01, seed,
        objective: point => {
          visited.push(point[0])
          const x = Math.max(-10, Math.min(20, point[0]))
          return Math.min(.001 * (x - 5) * (x - 5), .0001 + .001 * (x - 8.6) * (x - 8.6))
        } })
      check(result.value < 1e-18 && Math.abs(result.parameters[0] - 5) < 1e-7, 'original basin lost after annealing')
      check(visited.some((value, index) => index > 1 && value === 0 && visited[index + 1] === 1),
        'original simplex was not refined after cooling')
    }
    // Exercise the annealing ABI through all common Stop/callback/growth/cleanup paths.
    checkOptimizer(module, (instance, options) => minimizeAnnealing(instance, { ...cold, ...options }),
      [], calculateParratt, calculateFitError)
  }
  return { cases: cases.length, validation: true, stop: true, growth: true, cleanup: true, reflectivity: true }
}
