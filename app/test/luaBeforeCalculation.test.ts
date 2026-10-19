import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createBeforeCalculation } from '../src/compute/lua/beforeCalculation'
import { createDefaultProject } from '../src/model/defaults'
import { calculateRealCurve, type RealCalculationEngine } from '../src/model/realCalculation'
import type { OpticalTable } from '../src/import/tables'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))

it('keeps one script context and its resolved table cache across refreshed project/cursor state', async () => {
  const project = createDefaultProject(); project.scripts.enabled = true
  project.calculation.automaticOpticalConstants = false // qz caller already refreshed it
  project.sample.layers[0].opticalTable = 'A'
  project.scripts.beforeCalculation = 'calls = (calls or 0) + 1; if calls == 1 then saved = delta; SetName(0, "B") else SetName(0, "A") end; SetDeltaBeta(0, 150); assert(saved[0] == 0.2); thickness[0] = thickness[0] + calls'
  const tables: OpticalTable[] = ['A', 'B'].map(name => ({ name, kind: 'db', energy: [100, 200], columns: [], warnings: [] }))
  const engine: RealCalculationEngine = { calculate: vi.fn(), energyScan: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(),
    matrixQz: vi.fn(), matrixEnergy: vi.fn(), dielectricTensor: () => ({ values: new Float64Array(18), anisotropic: false }),
    lookup: vi.fn((table, _queries, cursor) => ({ values: new Float64Array([table.name === 'A' ? .1 : .2, 0]), cursor: cursor + 1 })) }
  const session = await runtime.createSession()
  try {
    const hook = createBeforeCalculation(session, engine, tables)
    const first = hook(project, { layers: project.sample.layers, dielectricTensors: project.sample.layers.map(() => null), cursors: new Map([[tables[0], 3]]) })
    expect(first.project.sample.layers[0].delta).toBe(.2)
    const updated = structuredClone(first.project); updated.sample.layers[0].thickness = 10
    const nextCursors = new Map(first.opticalState.cursors); nextCursors.set(tables[1], 7)
    const second = hook(updated, { ...first.opticalState, cursors: nextCursors })
    expect(second.project.sample.layers[0].thickness).toBe(12)
    expect(vi.mocked(engine.lookup).mock.calls.map(call => [call[0].name, call[2]])).toEqual([['B', 0], ['B', 7]])
    expect(session.getGlobal('calls')).toBe(2)
    expect(first.opticalState.cursors.get(tables[1])).toBe(1)
    expect(nextCursors.get(tables[1])).toBe(7)
    expect(second.opticalState.cursors.get(tables[1])).toBe(8)
    expect(project.sample.layers[0].opticalTable).toBe('A')
    updated.scripts.beforeCalculation = 'different = true'
    expect(() => hook(updated, second.opticalState)).toThrow('source changed')
    expect(() => session.getGlobal('calls')).toThrow('closed')
  } finally { session.close() }
})

it('retains isotropic tensor values across scalar edits until FillTensors explicitly rebuilds them', async () => {
  const project = createDefaultProject(); project.scripts.enabled = true
  project.scripts.beforeCalculation = 'calls = (calls or 0) + 1; if calls == 1 then delta[0] = 0.2 elseif calls == 2 then oldTensor = exx_r[0]; FillTensors(); newTensor = exx_r[0] end'
  const construct = vi.fn((request: Parameters<RealCalculationEngine['dielectricTensor']>[0]) => ({ values: new Float64Array(18).fill(request.layer[2]), anisotropic: false }))
  const engine: RealCalculationEngine = { calculate: vi.fn(), energyScan: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(),
    matrixQz: vi.fn(), matrixEnergy: vi.fn(), lookup: vi.fn(), dielectricTensor: construct }
  const initialDelta = project.sample.layers[0].delta
  const session = await runtime.createSession()
  try {
    const hook = createBeforeCalculation(session, engine, [])
    const first = hook(project, { layers: project.sample.layers, dielectricTensors: project.sample.layers.map(() => null), cursors: new Map() })
    expect(first.opticalState.dielectricTensors[0]).toBeNull()
    expect(first.opticalState.dielectricState![0]!.values[0]).toBe(initialDelta)
    const changed = structuredClone(first.project); changed.sample.layers[0].delta = .3
    const second = hook(changed, first.opticalState)
    expect(session.getGlobal('oldTensor')).toBe(initialDelta)
    expect(session.getGlobal('newTensor')).toBe(.3)
    expect(second.opticalState.dielectricState![0]!.anisotropic).toBe(true)
    expect(first.opticalState.dielectricState![0]!.anisotropic).toBe(false)
    expect(first.opticalState.dielectricState![0]!.values[0]).toBe(initialDelta)
  } finally { session.close() }
})


it('invalidates only tensors whose optical tables were refreshed before the script', async () => {
  const project = createDefaultProject(); project.scripts.enabled = true
  project.calculation.automaticOpticalConstants = true
  project.experiment.energy = 150; project.experiment.qzScan.points = 2
  project.sample.layers.forEach((layer, index) => { layer.opticalTable = index === 0 ? 'missing' : 'available' })
  project.scripts.beforeCalculation = 'retained = exx_r[0]; refreshed = exx_r[1]'
  const state = { layers: project.sample.layers, dielectricTensors: project.sample.layers.map(() => null),
    dielectricState: project.sample.layers.map(() => ({ values: new Float64Array(18).fill(7), anisotropic: false })), cursors: new Map<OpticalTable, number>() }
  const engine: RealCalculationEngine = { calculate: request => new Float64Array(request.qz.length * 2).fill(1),
    energyScan: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), matrixQz: vi.fn(), matrixEnergy: vi.fn(),
    lookup: () => ({ values: new Float64Array([.02, 0]), cursor: 1 }),
    dielectricTensor: request => ({ values: new Float64Array(18).fill(request.layer[2]), anisotropic: false }) }
  const tables: OpticalTable[] = [{ name: 'available', kind: 'db', energy: [100, 200], columns: [], warnings: [] }]
  const session = await runtime.createSession()
  try {
    const result = calculateRealCurve(project, tables, engine, 'qz', 'monochromatic', state, createBeforeCalculation(session, engine, tables))
    expect(session.getGlobal('retained')).toBe(7)
    expect(session.getGlobal('refreshed')).toBe(.02)
    expect(result.opticalState.dielectricState![0]!.anisotropic).toBe(true)
    expect(state.dielectricState.every(tensor => !tensor.anisotropic && tensor.values[0] === 7)).toBe(true)
  } finally { session.close() }
})


it.each(['Imag', 'Real'] as const)('line-shape %s reads stored state energy until hook globals are committed', async part => {
  const project = createDefaultProject(); project.experiment.energy = 640
  project.scripts.beforeCalculation = `energy = 900; value = GetGaussLorentzian${part}(640, 0.03, 0.1, 50)`
  const engine: RealCalculationEngine = { calculate: vi.fn(), energyScan: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(),
    matrixQz: vi.fn(), matrixEnergy: vi.fn(), lookup: vi.fn(),
    dielectricTensor: () => ({ values: new Float64Array(18), anisotropic: false }),
    [`gaussLorentzian${part}`]: vi.fn((energy: number) => energy) }
  const session = await runtime.createSession()
  try {
    const hook = createBeforeCalculation(session, engine, [])
    const first = hook(project, { layers: project.sample.layers, dielectricTensors: project.sample.layers.map(() => null), cursors: new Map() })
    expect(session.getGlobal('value')).toBe(640)
    hook(first.project, first.opticalState)
    expect(session.getGlobal('value')).toBe(900)
    expect(vi.mocked(engine[`gaussLorentzian${part}`]!).mock.calls.map(args => args.slice(1))).toEqual([[640, .03, .1, 50], [640, .03, .1, 50]])
  } finally { session.close() }
})
