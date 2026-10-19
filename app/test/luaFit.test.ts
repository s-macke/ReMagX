import type { OpticalTable } from '../src/import/tables'
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
  project.sample.elementProfiles = [{ element: 'Fe', f1: 1, f2: 2, f1Mag: 3, f2Mag: 4, slabs: [] }]
  const before = structuredClone(project)
  engine.dielectricTensor = () => ({ values: new Float64Array(18), anisotropic: false })
  const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
  const session = await runtime.createSession()
  const messages: string[] = []
  try {
    const retained = [new Float64Array(18).fill(3)]
    const innerHook = createBeforeCalculation(session, engine, [], text => messages.push(text))
    const hook = vi.fn<typeof innerHook>((current, opticalState, renew, lifetime) => {
      if (hook.mock.calls.length > 1) expect(opticalState.scatteringTensors).toEqual(retained)
      return innerHook(current, { ...opticalState, scatteringTensors: retained }, renew, lifetime)
    })
    const minimize: RealMinimizer = ({ objective }) => {
      const value = objective(new Float64Array([0]))
      objective(new Float64Array([1]))
      return { termination: 'converged', parameters: new Float64Array([0]), value, iterations: 1, evaluations: 2 }
    }
    const result = runRealFit(project, [], engine, minimize, vi.fn(), undefined, hook)
    expect(messages).toEqual(['1:0', '2:1', '3:0', '4:0', '5:1', '6:0', '7:0'])
    expect(hook.mock.calls.map(call => call[3])).toEqual(['temporary', 'existing', 'existing', 'existing', 'existing', 'existing', 'existing'])
    expect(session.getGlobal('epsilon')).toBeCloseTo(initialEpsilon + .007, 14)
    expect(result.project.calculation.epsilon).toBeCloseTo(initialEpsilon + .004, 14)
    expect(result.project.sample.layers[0].delta).toBeCloseTo(.014, 14)
    expect(result.project.scripts.enabled).toBe(true)
    expect(engine.calculate).toHaveBeenCalledTimes(4)
    expect(project).toEqual(before)
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


it('reuses the fit session for energy datasets but initializes a fresh energy session per standalone chi2 dataset', async () => {
  const { project, engine } = fixture()
  project.calculation.automaticOpticalConstants = false
  project.experiment.energy = 640
  project.sample.layers.forEach(layer => { layer.opticalTable = 'sample' })
  project.datasets[0].columns = { energy: [640, 900, 650], qz: [.02, .03, .04], reflectivity: [1, 1, 1] }
  project.scripts.enabled = true
  project.scripts.beforeCalculation = 'calls = (calls or 0) + 1; print(calls, ":", renewocs); epsilon = epsilon + 0.001; energy = energy + 1'
  const initialEpsilon = project.calculation.epsilon
  const original = structuredClone(project)
  engine.energyScan = vi.fn(request => new Float64Array(request.energy.flatMap(() => [1, 0])))
  engine.dielectricTensor = () => ({ values: new Float64Array(18), anisotropic: false })
  engine.lookup = () => ({ values: new Float64Array([.01, 0]), cursor: 0 })
  const tables = [{ name: 'sample', kind: 'db' as const, energy: [600, 700], columns: [], warnings: [] }]
  const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
  const messages: string[] = []
  const session = await runtime.createSession()
  try {
    const minimize: RealMinimizer = ({ objective }) => {
      const value = objective(new Float64Array([0]))
      objective(new Float64Array([1]))
      return { termination: 'converged', parameters: new Float64Array([0]), value, iterations: 1, evaluations: 2 }
    }
    const result = runRealFit(project, tables, engine, minimize, vi.fn(), undefined,
      createBeforeCalculation(session, engine, tables, text => messages.push(text)))
    expect(messages).toEqual(['1:0', '2:1', '3:0', '4:0', '5:0', '6:1', '7:0', '8:0', '9:0'])
    expect(result.project.calculation.epsilon).toBeCloseTo(initialEpsilon + .005, 14)
    expect(session.getGlobal('epsilon')).toBeCloseTo(initialEpsilon + .009, 14)
    expect(engine.energyScan).toHaveBeenCalledTimes(2)
    expect(vi.mocked(engine.energyScan).mock.calls[0][0].pointSettings?.map(row => row[0])).toEqual([641, 900, 651])
    expect(result.project.experiment.energy).toBe(641)
    expect(project).toEqual(original)
  } finally { session.close() }
  project.datasets[1] = structuredClone(project.datasets[0])
  project.datasets[0].errorWeight = 0
  const send = vi.fn()
  const createSession = vi.fn(() => runtime.createSession())
  await createRealRequestHandler(send, async () => engine, createSession)({ id: 1, kind: 'chi2', project, tables })
  expect(createSession).toHaveBeenCalledTimes(2)
  expect(send.mock.calls.map(([message]) => message.type === 'scriptMessages' ? message.lines[0] : message.result)).toEqual([
    '1:0', '2:0', '3:0', '1:0', '2:0', '3:0', 1,
  ])
})


it.each(['reflectivity', 'asymmetry', 'energyScan', 'energyAsymmetry', 'fit'] as const)(
  'streams Lua output before a %s failure without publishing a result', async kind => {
    const { project, engine } = fixture()
    project.calculation.automaticOpticalConstants = false
    project.experiment.qzScan.useDatasetPoints = true
    if (kind === 'energyScan' || kind === 'energyAsymmetry') project.datasets[0].columns.energy = [640]
    project.scripts.enabled = true
    project.scripts.beforeCalculation = 'print("before failure")\nerror("broken script")'
    engine.dielectricTensor = () => ({ values: new Float64Array(18), anisotropic: false })
    engine.minimize = vi.fn()
    const tables: OpticalTable[] = []
    if (kind === 'energyScan' || kind === 'energyAsymmetry') {
      // Reach Lua only after the energy button's strict primary-table gate.
      project.experiment.energy = 640
      project.sample.layers.forEach(layer => { layer.opticalTable = 'script-input' })
      tables.push({ name: 'script-input', kind: 'db', energy: [600, 700], columns: [], warnings: [] })
      engine.lookup = (_table, _energy, cursor) => ({ values: new Float64Array([.01, 0]), cursor: cursor + 1 })
    }
    const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
    const send = vi.fn()
    const before = structuredClone(project)
    const handle = createRealRequestHandler(send, async () => engine, () => runtime.createSession())
    await handle({ id: 7, kind, project, tables })
    expect(send.mock.calls[0][0]).toEqual({ id: 7, type: 'scriptMessages', lines: ['before failure'] })
    expect(send.mock.calls[1][0]).toMatchObject({ id: 7, type: 'error' })
    expect(send.mock.calls[1][0].message).toMatch(/BeforeCalculation:2:.*broken script/)
    expect(send).toHaveBeenCalledTimes(2)
    expect(project).toEqual(before)
  })
