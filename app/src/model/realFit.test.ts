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
  project.fit.algorithm = 'simplex-annealing'; expect(run).toThrow('annealing')
  project.fit.algorithm = 'simplex'; project.fit.occamQ = 1; expect(run).toThrow('regularization')
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
