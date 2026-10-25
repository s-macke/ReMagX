import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import type { Dataset } from './project'
import type { RealEngine } from '../compute/realEngine'
import { runRealFit, FitStoppedBeforeEvaluation, type RealMinimizer } from './realFit'

function fixture() {
  const project = createDefaultProject()
  project.fit.algorithm = 'simplex'; project.fit.occamQ = 0
  project.sample.layers = [createLayer({ delta: .01 }), createLayer()]
  const data: Dataset = { title: '', comment: '', sourceFile: '', energy: 640, energyShift: 0, qzShift: 0,
    angularResolution: 0, intensityScale: 1, intensityOffset: 0, active: true, errorWeight: 1,
    polarization: project.experiment.polarization, columns: { qz: [.02], reflectivity: [1] } }
  project.datasets = [data, structuredClone(data)]; project.activeDatasetIndex = 0
  project.fit.parameters = [{ target: 'qzShift', index: null, elementIndex: null, value: 0, step: 0, lowerBound: -1, upperBound: 1 }]
  const engine: RealEngine = { calculate: vi.fn(() => new Float64Array([1, 0])), lookup: vi.fn(), energyScan: vi.fn(),
    zakQz: vi.fn(), zakEnergy: vi.fn(), matrixQz: vi.fn(), matrixEnergy: vi.fn(), dielectricTensor: vi.fn(),
    fitError: vi.fn(() => ({ error: 1, accepted: 1 })) }
  return { project, engine }
}

it('retains the best evaluated snapshot as later candidates advance the current dataset context', () => {
  const { project, engine } = fixture()
  const before = structuredClone(project)
  const errors = [2, 2, 1, 1, 3, 3]
  vi.mocked(engine.fitError).mockImplementation(() => ({ error: errors.shift()!, accepted: 1 }))
  const progress = vi.fn(event => { event.values[0] = 999 })
  const minimize: RealMinimizer = ({ simplex, objective, onProgress }) => {
    expect(simplex).toEqual([[0], [1]])
    expect(objective(new Float64Array([0]))).toBe(4)
    expect(objective(new Float64Array([1]))).toBe(2)
    onProgress({ parameters: new Float64Array([1]), value: 2, iterations: 1, evaluations: 2 })
    expect(objective(new Float64Array([2]))).toBe(6)
    return { termination: 'iteration-limit', parameters: new Float64Array([1]), value: 2, iterations: 2, evaluations: 3 }
  }
  const result = runRealFit(project, [], engine, minimize, progress)
  expect(result).toMatchObject({ chi2: 2, values: [.05], iterations: 2, stopped: false })
  expect(result.project.datasets.map(data => data.qzShift)).toEqual([0, .05])
  expect(result.project.activeDatasetIndex).toBe(1)
  expect(result.datasetUpdates).toEqual([{ index: 0, values: { qzShift: 0 } }, { index: 1, values: { qzShift: .05 } }])
  expect(vi.mocked(engine.calculate).mock.calls.map(([request]) => request.qz[0])).toEqual([.02, .02, .02, .07, .02, .02 + .1])
  expect(project).toEqual(before)
})

it('evaluates fixed rows once without invoking a zero-dimensional optimizer', () => {
  const { project, engine } = fixture()
  project.fit.parameters[0].lowerBound = .1; project.fit.parameters[0].upperBound = .1
  const minimize = vi.fn<RealMinimizer>()
  const result = runRealFit(project, [], engine, minimize, vi.fn())
  expect(result).toMatchObject({ values: [.1], chi2: 2, iterations: 0, stopped: false })
  expect(minimize).not.toHaveBeenCalled()
  expect(engine.fitError).toHaveBeenCalledTimes(2)
})

it('reports unsupported fits, cancellation and numerical failures explicitly', () => {
  const { project, engine } = fixture()
  const minimize = vi.fn<RealMinimizer>()
  const run = () => runRealFit(project, [], engine, minimize, vi.fn())
  project.fit.occamQ = 0; project.datasets.forEach(data => { data.active = false }); expect(run).toThrow('dataset')
  project.datasets[0].active = true
  expect(() => runRealFit(project, [], engine, minimize, vi.fn(), () => true)).toThrow(FitStoppedBeforeEvaluation)
  expect(minimize).not.toHaveBeenCalled()
  minimize.mockImplementation(({ objective }) => {
    const value = objective(new Float64Array([0]))
    return { termination: 'stopped', value, parameters: new Float64Array([0]), iterations: 0, evaluations: 1 }
  })
  expect(run().stopped).toBe(true)
  vi.mocked(engine.calculate).mockImplementation(() => { throw new Error('failed calculation') })
  expect(run).toThrow('failed calculation')
})

it('reports independent curves from the best evaluation without recalculating or adopting a worse trial', () => {
  const { project, engine } = fixture()
  project.activeDatasetIndex = 1
  const errors = [2, 2, 1, 1, 3, 3]
  vi.mocked(engine.fitError).mockImplementation(() => ({ error: errors.shift()!, accepted: 1 }))
  const curves: number[][] = []
  const minimize: RealMinimizer = ({ objective, onProgress }) => {
    objective(new Float64Array([0])); objective(new Float64Array([1]))
    onProgress({ parameters: new Float64Array([1]), value: 2, iterations: 1, evaluations: 2 })
    objective(new Float64Array([2]))
    onProgress({ parameters: new Float64Array([1]), value: 2, iterations: 2, evaluations: 3 })
    return { termination: 'converged', parameters: new Float64Array([1]), value: 2, iterations: 2, evaluations: 3 }
  }
  runRealFit(project, [], engine, minimize, progress => {
    expect(progress.datasetPreview).toMatchObject({ datasetIndex: 1, scan: 'qz', beams: 'monochromatic', qz: [.07] })
    curves.push(progress.datasetPreview!.qz.slice())
    progress.datasetPreview!.qz[0] = 999
    progress.datasetPreview!.reflectivityPlus[0] = 999
  })
  expect(curves).toEqual([[.07], [.07]])
  expect(engine.calculate).toHaveBeenCalledTimes(6)
})

it('does not substitute another dataset when the selected dataset is excluded from fitting', () => {
  const { project, engine } = fixture()
  project.datasets[0].active = false
  project.fit.parameters[0].lowerBound = 0; project.fit.parameters[0].upperBound = 0
  const progress = vi.fn()
  runRealFit(project, [], engine, vi.fn(), progress)
  expect(progress.mock.calls[0][0].datasetPreview).toBeUndefined()
})

it('retains missing-table layers during fit initialization and later qz dataset refreshes', () => {
  const { project, engine } = fixture()
  project.experiment.energy = 640
  project.calculation.automaticOpticalConstants = true
  project.sample.layers[0].opticalTable = 'available'
  project.sample.layers[1].opticalTable = 'missing'
  project.fit.parameters[0].lowerBound = 0; project.fit.parameters[0].upperBound = 0
  vi.mocked(engine.lookup).mockImplementation((_table, _energies, cursor) => ({ values: new Float64Array([.02, .001]), cursor: cursor + 1 }))
  const before = structuredClone(project)
  const result = runRealFit(project, [{ name: 'available', kind: 'db', energy: [600, 800], columns: [[.02, .02], [.001, .001]], warnings: [] }], engine, vi.fn(), vi.fn())
  expect(result.chi2).toBe(2)
  expect(vi.mocked(engine.lookup).mock.calls.map(call => call[2])).toEqual([0, 1, 2])
  for (const [request] of vi.mocked(engine.calculate).mock.calls) {
    expect(request.layers.map(layer => layer[2])).toEqual([.02, 0])
  }
  expect(project).toEqual(before)
})


it('routes saved annealing settings and the legacy shared fit seed with explicit override', () => {
  const { project, engine } = fixture()
  project.fit.algorithm = 'simplex-annealing'
  project.fit.annealing = { temperature: 2.5, temperatureStep: -.125 }
  project.fit.evolution.randomSeed = 999
  const before = structuredClone(project)
  const minimize = vi.fn<RealMinimizer>(({ objective }) => {
    const parameters = new Float64Array([0])
    return { termination: 'converged', parameters, value: objective(parameters), iterations: 1, evaluations: 1 }
  })
  runRealFit(project, [], engine, minimize, vi.fn())
  expect(minimize.mock.calls[0][0].annealing).toEqual({ temperature: 2.5, temperatureStep: -.125, seed: 999 })
  runRealFit(project, [], engine, minimize, vi.fn(), undefined, undefined, undefined, 4294967295)
  expect(minimize.mock.calls[1][0].annealing?.seed).toBe(4294967295)
  expect(project).toEqual(before)
  project.fit.algorithm = 'simplex'
  runRealFit(project, [], engine, minimize, vi.fn())
  expect(minimize.mock.calls[2][0].annealing).toBeUndefined()
})

it('rejects invalid annealing settings before calculation or script execution', () => {
  const { project, engine } = fixture()
  project.fit.algorithm = 'simplex-annealing'
  const minimize = vi.fn<RealMinimizer>(), hook = vi.fn()
  for (const [temperature, temperatureStep, seed] of [[-1, -.01, 0], [Infinity, 0, 0], [1, NaN, 0], [1, 0, -1], [1, 0, 2 ** 32]]) {
    project.fit.annealing = { temperature, temperatureStep }
    expect(() => runRealFit(project, [], engine, minimize, vi.fn(), undefined, hook, undefined, seed)).toThrow('Annealing')
  }
  expect(minimize).not.toHaveBeenCalled()
  expect(hook).not.toHaveBeenCalled()
  expect(engine.calculate).not.toHaveBeenCalled()
})


it('normalizes saved signed or wide integer seeds to the Windows uint32 domain', () => {
  const { project, engine } = fixture()
  project.fit.algorithm = 'simplex-annealing'
  const minimize = vi.fn<RealMinimizer>(({ objective }) => {
    const parameters = new Float64Array([0])
    return { termination: 'converged', parameters, value: objective(parameters), iterations: 1, evaluations: 1 }
  })
  for (const [saved, expected] of [[-1, 4294967295], [2 ** 32 + 7, 7], [0, 0], [100, 100]]) {
    project.fit.evolution.randomSeed = saved
    runRealFit(project, [], engine, minimize, vi.fn())
    expect(minimize.mock.calls.at(-1)?.[0].annealing?.seed).toBe(expected)
    expect(project.fit.evolution.randomSeed).toBe(saved)
  }
  project.fit.evolution.randomSeed = Number.MAX_SAFE_INTEGER + 1
  expect(() => runRealFit(project, [], engine, minimize, vi.fn())).toThrow('seed')
  expect(minimize).toHaveBeenCalledTimes(4)
})


it('adds annealing Q after weighted dataset errors using the original unbounded parameter reference', () => {
  const { project, engine } = fixture()
  project.fit.algorithm = 'simplex-annealing'; project.fit.occamQ = 2
  project.fit.parameters[0].value = 2 // saved reference lies outside [-1, 1]
  const before = structuredClone(project)
  const progress = vi.fn()
  const minimize: RealMinimizer = ({ objective, onProgress }) => {
    // Initial bounded candidate 1: weighted dataset error 2 + 2*(2-1)^2.
    expect(objective(new Float64Array([0]))).toBe(4)
    // Axis runs inward from the upper bound, scale -0.1: candidate 0.5.
    expect(objective(new Float64Array([5]))).toBe(6.5)
    // Strict legacy threshold omits the penalty at candidate zero.
    expect(objective(new Float64Array([10]))).toBe(2)
    onProgress({ parameters: new Float64Array([10]), value: 2, iterations: 1, evaluations: 3 })
    return { termination: 'iteration-limit', parameters: new Float64Array([10]), value: 2, iterations: 1, evaluations: 3 }
  }
  const result = runRealFit(project, [], engine, minimize, progress)
  expect(result.chi2).toBe(2)
  expect(result.values[0]).toBeCloseTo(0, 14)
  expect(progress.mock.calls[0][0].chi2).toBe(2)
  expect(project).toEqual(before)
})

it('includes signed annealing regularization for fixed rows and rejects nonfinite weights', () => {
  const { project, engine } = fixture()
  project.fit.algorithm = 'simplex-annealing'; project.fit.occamQ = -2
  project.fit.parameters[0].value = 2
  project.fit.parameters[0].lowerBound = 1; project.fit.parameters[0].upperBound = 1
  const minimize = vi.fn<RealMinimizer>()
  expect(runRealFit(project, [], engine, minimize, vi.fn()).chi2).toBe(0)
  expect(minimize).not.toHaveBeenCalled()
  for (const weight of [NaN, Infinity, -Infinity]) {
    project.fit.occamQ = weight
    expect(() => runRealFit(project, [], engine, minimize, vi.fn())).toThrow('regularization weight')
  }
})


it('maps ordinary Q references, clips only on refresh and preserves the best trial snapshot', () => {
  const { project, engine } = fixture()
  project.fit.occamQ = 2
  project.fit.parameters[0].value = .5 // normalized axis scale .025
  project.fit.parameters.push({ target: 'intensityScale', index: null, elementIndex: null,
    value: 2, step: 0, lowerBound: 1, upperBound: 1 })
  const before = structuredClone(project)
  const progress = vi.fn()
  let refresh = false
  vi.mocked(engine.fitError).mockImplementation(() => ({ error: refresh ? 0 : 1, accepted: 1 }))
  const minimize: RealMinimizer = ({ objective, onReference, onProgress }) => {
    expect(onReference).toBeTypeOf('function')
    // Initialization retains the saved fixed-row reference 2, candidate 1.
    expect(objective(new Float64Array([0]))).toBe(4)
    const selected = new Float64Array([40]) // full reference [1.5, 1]
    onReference!({ parameters: selected, phase: 'selected', iterations: 0, evaluations: 1 })
    selected[0] = 999 // callback mapping owns its reference
    // Trial is clipped to 1; selected reference remains 1.5.
    const score = objective(new Float64Array([40]))
    expect(score).toBeCloseTo(2.5, 14)
    refresh = true
    onReference!({ parameters: new Float64Array([40]), phase: 'completed', iterations: 1, evaluations: 2 })
    refresh = false
    // Reference refresh scored zero, but must not replace the native best trial.
    onProgress({ parameters: new Float64Array([40]), value: score, iterations: 1, evaluations: 2 })
    expect(objective(new Float64Array([-10]))).toBeCloseTo(3.125, 14) // clipped reference now 1
    return { termination: 'iteration-limit', parameters: new Float64Array([40]), value: score, iterations: 1, evaluations: 3 }
  }
  const result = runRealFit(project, [], engine, minimize, progress)
  expect(result.chi2).toBeCloseTo(2.5, 14)
  expect(result.values).toEqual([1, 1])
  expect(result.regularizationReference?.[0]).toBeCloseTo(1.5, 14)
  expect(result.regularizationReference?.[1]).toBe(1)
  expect(result.project.datasets.map(dataset => dataset.qzShift)).toEqual([.5, 1])
  expect(progress.mock.calls[0][0].values).toEqual([1, 1])
  expect(engine.fitError).toHaveBeenCalledTimes(8)
  expect(project).toEqual(before)
})

it('omits reference callbacks for zero Q and annealing, and skips refresh on Stop', () => {
  for (const algorithm of ['simplex', 'simplex-annealing'] as const) {
    const { project, engine } = fixture()
    project.fit.algorithm = algorithm
    project.fit.occamQ = algorithm === 'simplex' ? 0 : 1
    const minimize: RealMinimizer = ({ objective, onReference }) => {
      expect(onReference).toBeUndefined()
      return { termination: 'converged', parameters: new Float64Array([0]),
        value: objective(new Float64Array([0])), iterations: 0, evaluations: 1 }
    }
    runRealFit(project, [], engine, minimize, vi.fn())
  }
  const { project, engine } = fixture()
  project.fit.occamQ = 1
  let stopped = false
  const minimize: RealMinimizer = ({ objective, onReference }) => {
    const value = objective(new Float64Array([0]))
    onReference!({ parameters: new Float64Array([0]), phase: 'selected', iterations: 0, evaluations: 1 })
    stopped = true
    onReference!({ parameters: new Float64Array([0]), phase: 'completed', iterations: 1, evaluations: 1 })
    return { termination: 'stopped', parameters: new Float64Array([0]), value, iterations: 1, evaluations: 1 }
  }
  expect(runRealFit(project, [], engine, minimize, vi.fn(), () => stopped).stopped).toBe(true)
  expect(engine.fitError).toHaveBeenCalledTimes(2)
})


it.each(['available', 'outside-range', 'missing'] as const)('refreshes automatic element factors before the fit hook: %s', availability => {
  const { project, engine } = fixture()
  project.sample.mode = 'element'; project.calculation.automaticOpticalConstants = true
  project.experiment.energy = 640
  project.sample.elementProfiles = [{ element: 'Fe', f1: 1, f2: 2, f1Mag: 3, f2Mag: 4,
    slabs: [{ thickness: 0, roughness: 0, density: .1 }] }]
  project.fit.parameters = [{ target: 'elementF1', index: null, elementIndex: 0,
    value: 100, step: 0, lowerBound: 90, upperBound: 110 }]
  project.scripts.enabled = true; project.scripts.beforeCalculation = '-- observe refreshed state'
  const table = { name: 'Fe', kind: 'ff' as const, energy: availability === 'outside-range' ? [700, 900] : [600, 900],
    columns: [[12, 12], [2, 2]], warnings: [] }
  vi.mocked(engine.lookup).mockReturnValue({ values: new Float64Array([12, 2]), cursor: 4 })
  engine.scatteringTensor = vi.fn(() => new Float64Array(18).fill(7))
  const initial = { layers: project.sample.layers, dielectricTensors: project.sample.layers.map(() => null),
    scatteringTensors: [new Float64Array(18).fill(3)], cursors: new Map([[table, 2]]) }
  const before = structuredClone(project)
  const observed = new Error('observed candidate hook')
  const hook = vi.fn((current, opticalState, renew) => {
    if (renew === 1) {
      expect(current.sample.elementProfiles[0].f1).toBe(availability === 'available' ? 12 : 100)
      expect(Array.from(opticalState.scatteringTensors[0])).toEqual(Array(18).fill(availability === 'available' ? 7 : 3))
      expect(opticalState.cursors.get(table)).toBe(availability === 'available' ? 4 : 2)
      expect(current.fit.parameters[0].value).toBe(100)
      throw observed
    }
    return { project: current, opticalState }
  })
  const minimize: RealMinimizer = ({ objective }) => {
    objective(new Float64Array([0]))
    throw new Error('unreachable')
  }
  expect(() => runRealFit(project, availability === 'missing' ? [] : [table], engine, minimize, vi.fn(),
    () => false, hook, initial)).toThrow(observed)
  expect(hook).toHaveBeenCalledTimes(2)
  expect(engine.scatteringTensor).toHaveBeenCalledTimes(availability === 'available' ? 1 : 0)
  expect(initial.cursors.get(table)).toBe(2)
  expect(Array.from(initial.scatteringTensors[0])).toEqual(Array(18).fill(3))
  expect(project).toEqual(before)
})

it.each(['simplex', 'simplex-annealing'] as const)('rejects deferred targets before %s evaluates and permits recovery', algorithm => {
  const { project, engine } = fixture()
  project.fit.algorithm = algorithm
  const minimize = vi.fn<RealMinimizer>(({ objective }) => ({
    termination: 'converged', parameters: new Float64Array([0]),
    value: objective(new Float64Array([0])), iterations: 0, evaluations: 1,
  }))
  const hook = vi.fn()
  for (const target of ['betaKramersKronig', 'deltaKramersKronig', 'electronEscapeDepth', 'electronGain'] as const) {
    project.fit.parameters[0].target = target
    const before = structuredClone(project)
    expect(() => runRealFit(project, [], engine, minimize, vi.fn(), () => false, hook))
      .toThrow(`Fit parameter "${target}" requires ${target.includes('Kramers') ? 'Kramers-Kronig' : 'TEY'}`)
    expect(project).toEqual(before)
  }
  expect(minimize).not.toHaveBeenCalled()
  expect(engine.calculate).not.toHaveBeenCalled()
  expect(engine.lookup).not.toHaveBeenCalled()
  expect(hook).not.toHaveBeenCalled()
  project.fit.parameters[0].target = 'qzShift'
  expect(runRealFit(project, [], engine, minimize, vi.fn()).chi2).toBe(2)
  expect(minimize).toHaveBeenCalledOnce()
})
