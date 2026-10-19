import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createRealRequestHandler, type RealEngine } from '../src/compute/realEngine'
import { prepareStandaloneEnergyScan } from '../src/model/standaloneEnergyScan'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import type { OpticalTable } from '../src/import/tables'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
function fixture() {
  const project = createDefaultProject()
  project.experiment.energy = 150; project.experiment.qzScan.points = 2
  project.experiment.energyScan = { energyMin: 100, energyMax: 200, fixed: 'qz', qz: .01, angle: 2 }
  project.sample.layers = [createLayer({ opticalTable: 'A', delta: .01,
    dielectricTensor: { values: Array(18).fill(9), anisotropic: true } }), createLayer({ opticalTable: 'A' })]
  project.sample.elementProfiles = [{ element: 'Fe', f1: 1, f2: 2, f1Mag: 0, f2Mag: 0, slabs: [], scatteringTensor: Array(18).fill(8) }]
  const tables: OpticalTable[] = [{ name: 'A', kind: 'db', energy: [100, 200], columns: [], warnings: [] }]
  const engine: RealEngine = { calculate: vi.fn(), fitError: vi.fn(), zakQz: vi.fn(), matrixQz: vi.fn(),
    energyScan: request => new Float64Array(request.energy.length * 2).fill(1),
    zakEnergy: request => new Float64Array(request.energy.length * 2).fill(1),
    matrixEnergy: request => new Float64Array(request.energy.length * 2).fill(1),
    dielectricTensor: request => ({ values: new Float64Array(18).fill(request.layer[2]), anisotropic: false }),
    scatteringTensor: () => new Float64Array(18).fill(4),
    lookup: vi.fn((_table, _energy, cursor) => ({ values: new Float64Array([.02, .003]), cursor: cursor + 1 })) }
  return { project, tables, engine }
}
it.each([false, true])('applies GetState then strict active refresh with automatic=%s and copies inactive tensors', automatic => {
  const { project, tables, engine } = fixture()
  project.calculation.automaticOpticalConstants = automatic
  const before = JSON.stringify(project)
  const prepared = prepareStandaloneEnergyScan(project, tables, engine)
  expect(prepared.project.sample.layers.map(layer => layer.delta)).toEqual([.02, .02])
  expect(prepared.opticalState.dielectricTensors).toEqual([null, null])
  expect(prepared.opticalState.dielectricState).toEqual([null, null])
  expect(prepared.opticalState.scatteringTensors![0][0]).toBe(automatic ? 8 : 4)
  expect(vi.mocked(engine.lookup).mock.calls.map(call => call[2])).toEqual(automatic ? [0, 1, 2, 3] : [0, 1])
  expect(JSON.stringify(project)).toBe(before)
  prepared.opticalState.scatteringTensors![0][0] = 99
  expect(project.sample.elementProfiles[0].scatteringTensor![0]).toBe(8)
})
it.each(['parratt', 'matrix', 'zak'] as const)('refreshes before the first standalone %s energy hook even in manual mode', async algorithm => {
  const { project, tables, engine } = fixture()
  project.calculation.algorithm = algorithm; project.calculation.automaticOpticalConstants = false
  project.scripts.enabled = true
  project.scripts.beforeCalculation = 'assert(delta[0] == 0.02 and exx_r[0] == 0.02); calls = (calls or 0) + 1; print(calls)'
  const send = vi.fn(), before = JSON.stringify(project)
  const handle = createRealRequestHandler(send, async () => engine, () => runtime.createSession())
  for (const kind of ['energyScan', 'energyAsymmetry'] as const) {
    await handle({ id: 1, kind, project, tables })
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'result', result: { scriptMessages: ['1', '2', '3', '4'] } })
  }
  expect(JSON.stringify(project)).toBe(before)
})
it.each([false, true])('fails strict missing/range gates before creating Lua with automatic=%s', async automatic => {
  const { project, tables, engine } = fixture()
  project.calculation.automaticOpticalConstants = automatic
  project.scripts.enabled = true; project.scripts.beforeCalculation = 'print("must not execute")'
  const createSession = vi.fn(() => runtime.createSession()), send = vi.fn()
  const handle = createRealRequestHandler(send, async () => engine, createSession)
  await handle({ id: 1, kind: 'energyScan', project, tables: [] })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('missing optical table') })
  project.experiment.energy = 90
  await handle({ id: 2, kind: 'energyAsymmetry', project, tables })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('outside') })
  expect(createSession).not.toHaveBeenCalled()
  expect(send.mock.calls.map(([response]) => response.type)).toEqual(['error', 'error'])
})
