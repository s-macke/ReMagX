import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createRealRequestHandler, type RealEngine } from '../src/compute/realEngine'
import { createRequestHandler } from '../src/compute/mockEngine'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import { prepareManualScript } from '../src/model/manualScript'
import type { OpticalTable } from '../src/import/tables'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
function fixture() {
  const project = createDefaultProject()
  project.experiment.energy = 150
  project.sample.layers = [createLayer({ opticalTable: 'A', delta: 9 }), createLayer({ opticalTable: 'missing', delta: 8 })]
  project.sample.elementProfiles = [{ element: 'Fe', f1: 5, f2: 6, f1Mag: 7, f2Mag: 8, slabs: [] }]
  const tables: OpticalTable[] = ['db', 'ff'].map(kind => ({ name: kind === 'db' ? 'A' : 'Fe', kind: kind as 'db' | 'ff', energy: [100, 200], columns: [], warnings: [] }))
  const engine: RealEngine = { calculate: vi.fn(), fitError: vi.fn(), energyScan: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), matrixQz: vi.fn(), matrixEnergy: vi.fn(),
    dielectricTensor: vi.fn(() => ({ values: new Float64Array(18).fill(3), anisotropic: false })),
    scatteringTensor: vi.fn(() => new Float64Array(18).fill(4)),
    lookup: vi.fn((_table, _queries, cursor) => ({ values: new Float64Array([.1, .2]), cursor: cursor + 1 })) }
  return { project, tables, engine }
}

it.each(['compound', 'element'] as const)('prepares only active %s tables and retains skipped/inactive state', mode => {
  const { project, tables, engine } = fixture()
  project.sample.mode = mode; project.calculation.automaticOpticalConstants = true
  const before = JSON.stringify(project)
  const result = prepareManualScript(project, tables, engine)
  expect(result.project.sample.layers.map(layer => layer.delta)).toEqual(mode === 'compound' ? [.1, 8] : [9, 8])
  expect(result.project.sample.elementProfiles[0].f1).toBe(mode === 'element' ? .1 : 5)
  expect(result.opticalState.scatteringTensors![0][0]).toBe(mode === 'element' ? 4 : 0)
  expect(result.opticalState.dielectricState![1]!.values).toEqual(new Float64Array(18))
  expect(engine.lookup).toHaveBeenCalledTimes(1)
  expect(engine.dielectricTensor).not.toHaveBeenCalled()
  expect(JSON.stringify(project)).toBe(before)
  result.project.sample.layers[1].magnetization.gamma = 17
  expect(project.sample.layers[1].magnetization.gamma).not.toBe(17)
})

it.each(['compound', 'element'] as const)('constructs both stored tensor sets in manual %s mode without reading tables', mode => {
  const { project, tables, engine } = fixture()
  project.sample.mode = mode; project.calculation.automaticOpticalConstants = false
  const result = prepareManualScript(project, tables, engine)
  expect(result.project).toEqual(project)
  expect(engine.lookup).not.toHaveBeenCalled()
  expect(engine.dielectricTensor).toHaveBeenCalledTimes(2)
  expect(engine.scatteringTensor).toHaveBeenCalledTimes(1)
  expect(result.opticalState.dielectricState!.map(tensor => tensor!.values[0])).toEqual([3, 3])
  expect(result.opticalState.scatteringTensors![0][0]).toBe(4)
})

it('runs either explicit program exactly once, retains full tensors, streams errors and recovers with a new VM', async () => {
  const { project, tables, engine } = fixture()
  project.calculation.automaticOpticalConstants = true; project.scripts.enabled = false
  const send = vi.fn(), sessions: Awaited<ReturnType<typeof runtime.createSession>>[] = []
  const handle = createRealRequestHandler(send, async () => engine, async () => {
    const session = await runtime.createSession(); vi.spyOn(session, 'close'); sessions.push(session); return session
  })
  for (const program of ['Default', 'BeforeCalculation'] as const) {
    const key = program === 'Default' ? 'default' : 'beforeCalculation'
    project.scripts[key] = 'assert(delta[0] == 0.1 and exx_r[1] == 0); calls = (calls or 0) + 1; print(calls); delta[1] = 2; exx_r[1] = 7'
    project.scripts[key === 'default' ? 'beforeCalculation' : 'default'] = 'error("wrong tab")'
    const before = JSON.stringify(project)
    await handle({ id: 1, kind: 'executeScript', project, spectrum: { program, tables } })
    expect(send.mock.calls.at(-2)![0]).toEqual({ id: 1, type: 'scriptMessages', lines: ['1'] })
    const response = send.mock.calls.at(-1)![0]
    expect(response.type).toBe('result')
    expect(response.result.project.sample.layers[1].delta).toBe(2)
    expect(response.result.project.scripts.enabled).toBe(false)
    expect(response.result.opticalState.dielectricState[1].values[0]).toBe(7)
    expect(response.result.scriptMessages).toEqual(['1'])
    expect(JSON.stringify(project)).toBe(before)
    expect(sessions.at(-1)!.close).toHaveBeenCalled()
  }
  project.scripts.default = 'delta[1] = 99\nprint("before error")\nerror("failed")'
  const before = JSON.stringify(project); send.mockClear()
  await handle({ id: 2, kind: 'executeScript', project, spectrum: { program: 'Default', tables } })
  expect(send.mock.calls.map(([response]) => response.type)).toEqual(['scriptMessages', 'error'])
  expect(send.mock.calls[1][0].message).toContain('Default:3')
  expect(JSON.stringify(project)).toBe(before)
  expect(sessions.at(-1)!.close).toHaveBeenCalled()
  project.scripts.default = 'assert(calls == nil); print("fresh")'
  await handle({ id: 3, kind: 'executeScript', project, spectrum: { program: 'Default', tables } })
  expect(send.mock.calls.at(-1)![0].result.scriptMessages).toEqual(['fresh'])
})

it('reports unavailable manual Lua explicitly in the mock and without a runtime', async () => {
  const { project, engine } = fixture(), send = vi.fn()
  const request = { id: 1, kind: 'executeScript' as const, project, spectrum: { program: 'Default' as const, tables: [] } }
  await createRequestHandler(send)(request)
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('mock') })
  await createRealRequestHandler(send, async () => engine)(request)
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('unavailable') })
})
