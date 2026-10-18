import { createRealRequestHandler } from '../src/compute/realEngine'
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


it('standalone chi2 uses fresh Lua globals but carries film state and table resolution across datasets', async () => {
  const { project, engine } = fixture()
  project.calculation.automaticOpticalConstants = false
  project.scripts.enabled = true
  project.sample.layers[0].opticalTable = 'A'
  project.scripts.beforeCalculation = `calls = (calls or 0) + 1; assert(calls == 1); assert(renewocs == 0)
    print("chi2:", calls)
    if thickness[0] == 0 then SetName(0, "B") else SetName(0, "A") end
    SetDeltaBeta(0, 150); thickness[0] = thickness[0] + 1`
  project.datasets[0].errorWeight = 0
  const before = structuredClone(project)
  engine.dielectricTensor = () => ({ values: new Float64Array(18), anisotropic: false })
  engine.lookup = vi.fn((table, _queries, cursor) => ({ values: new Float64Array([table.name === 'B' ? .02 : .03, 0]), cursor: cursor + 1 }))
  const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
  const closes: ReturnType<typeof vi.spyOn>[] = []
  const createSession = async () => { const session = await runtime.createSession(); closes.push(vi.spyOn(session, 'close')); return session }
  const messages = vi.fn()
  const handle = createRealRequestHandler(messages, async () => engine, createSession)
  const tables = ['A', 'B'].map(name => ({ name, kind: 'db' as const, energy: [100, 200], columns: [], warnings: [] }))
  await handle({ id: 1, kind: 'chi2', project, tables })
  expect(messages.mock.calls.map(([message]) => message)).toEqual([
    { id: 1, type: 'scriptMessages', lines: ['chi2:1'] },
    { id: 1, type: 'scriptMessages', lines: ['chi2:1'] },
    { id: 1, type: 'result', result: 1 },
  ])
  expect(vi.mocked(engine.lookup).mock.calls.map(([table, , cursor]) => [table.name, cursor])).toEqual([['B', 0], ['B', 1]])
  expect(vi.mocked(engine.calculate).mock.calls.map(([request]) => request.layers[0][2])).toEqual([.02, .02])
  expect(closes).toHaveLength(2)
  expect(closes.every(close => close.mock.calls.length > 0)).toBe(true)
  expect(project).toEqual(before)
  project.scripts.beforeCalculation = 'print("before failure")\nlocal x = 1\nerror("chi2 failure")'
  await handle({ id: 2, kind: 'chi2', project, tables })
  expect(messages.mock.calls.at(-2)![0]).toEqual({ id: 2, type: 'scriptMessages', lines: ['before failure'] })
  expect(messages.mock.calls.at(-1)![0]).toMatchObject({ id: 2, type: 'error', message: expect.stringContaining('BeforeCalculation:3:') })
  expect(closes).toHaveLength(3)
  expect(closes[2]).toHaveBeenCalled()
})
