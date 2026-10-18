import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createBeforeCalculation } from '../src/compute/lua/beforeCalculation'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import type { Dataset } from '../src/model/project'
import type { RealEngine } from '../src/compute/realEngine'
import { runRealFit, type RealMinimizer } from '../src/model/realFit'

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

it('runs persistent Lua initialization, objective renewal and serial dataset hooks without losing script state', async () => {
  const { project, engine } = fixture()
  project.calculation.automaticOpticalConstants = false
  project.scripts.enabled = true
  project.scripts.beforeCalculation = `calls = (calls or 0) + 1
    print(calls, ":", renewocs)
    epsilon = epsilon + 0.001
    delta[0] = delta[0] + 0.001`
  const initialEpsilon = project.calculation.epsilon
  const before = structuredClone(project)
  engine.dielectricTensor = () => ({ values: new Float64Array(18), anisotropic: false })
  const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
  const session = await runtime.createSession()
  const messages: string[] = []
  try {
    const hook = createBeforeCalculation(session, engine, [], text => messages.push(text))
    const minimize: RealMinimizer = ({ objective }) => {
      const value = objective(new Float64Array([0]))
      objective(new Float64Array([1]))
      return { termination: 'converged', parameters: new Float64Array([0]), value, iterations: 1, evaluations: 2 }
    }
    const result = runRealFit(project, [], engine, minimize, vi.fn(), undefined, hook)
    expect(messages).toEqual(['1:0', '2:1', '3:0', '4:0', '5:1', '6:0', '7:0'])
    expect(session.getGlobal('epsilon')).toBeCloseTo(initialEpsilon + .007, 14)
    expect(result.project.calculation.epsilon).toBeCloseTo(initialEpsilon + .004, 14)
    expect(result.project.sample.layers[0].delta).toBeCloseTo(.014, 14)
    expect(result.project.scripts.enabled).toBe(true)
    expect(engine.calculate).toHaveBeenCalledTimes(4)
    expect(project).toEqual(before)
    project.datasets[1].columns.energy = [640]
    expect(() => runRealFit(project, [], engine, minimize, vi.fn(), undefined, hook)).toThrow('energy-scan fits')
    expect(messages).toHaveLength(7)
  } finally { session.close() }
})
