import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createRealRequestHandler, type RealEngine } from '../src/compute/realEngine'
import { prepareStandaloneQz } from '../src/model/standaloneQz'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import type { OpticalTable } from '../src/import/tables'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
function fixture() {
  const project = createDefaultProject()
  project.experiment.energy = 150; project.experiment.qzScan.points = 2; project.experiment.qzScan.qzMax = .02
  project.sample.layers = [createLayer({ opticalTable: 'A', delta: .01,
    dielectricTensor: { values: Array(18).fill(9), anisotropic: true } }), createLayer({ opticalTable: 'A' })]
  const tables: OpticalTable[] = [{ name: 'A', kind: 'db', energy: [100, 200], columns: [], warnings: [] }]
  const engine: RealEngine = { calculate: request => new Float64Array(request.qz.length * 2).fill(1), fitError: vi.fn(),
    zakQz: vi.fn(), matrixQz: request => new Float64Array(request.qz.length * 2).fill(1),
    energyScan: vi.fn(), zakEnergy: vi.fn(), matrixEnergy: vi.fn(),
    dielectricTensor: request => ({ values: new Float64Array(18).fill(request.layer[2]), anisotropic: false }),
    lookup: vi.fn((_table, _energy, cursor) => ({ values: new Float64Array([.02, .003]), cursor: cursor + 1 })) }
  return { project, tables, engine }
}
it.each([false, true])('replaces stale manual overrides with the rebuilt classification anisotropic=%s', anisotropic => {
  const { project, engine } = fixture()
  project.calculation.automaticOpticalConstants = false
  engine.dielectricTensor = () => ({ values: new Float64Array(18).fill(3), anisotropic })
  const before = JSON.stringify(project), prepared = prepareStandaloneQz(project, [], engine)
  expect(prepared.opticalState.dielectricState![0]!.values[0]).toBe(3)
  expect(prepared.opticalState.dielectricTensors[0]).toEqual(anisotropic ? new Float64Array(18).fill(3) : null)
  if (anisotropic) {
    prepared.opticalState.dielectricTensors[0]![0] = 5
    expect(prepared.opticalState.dielectricState![0]!.values[0]).toBe(3)
  }
  expect(engine.lookup).not.toHaveBeenCalled()
  expect(JSON.stringify(project)).toBe(before)
})
it.each(['reflectivity', 'asymmetry'] as const)('refreshes GetState, strict gate and kernel in order for %s', async kind => {
  const { project, tables, engine } = fixture()
  project.calculation.automaticOpticalConstants = true; project.scripts.enabled = true
  project.scripts.beforeCalculation = 'assert(delta[0] == 0.02 and exx_r[0] == 0.02); print("prepared")'
  const before = JSON.stringify(project), send = vi.fn()
  await createRealRequestHandler(send, async () => engine, () => runtime.createSession())({ id: 1, kind, project, tables })
  expect(send.mock.calls[0][0]).toEqual({ id: 1, type: 'scriptMessages', lines: ['prepared'] })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'result' })
  expect(vi.mocked(engine.lookup).mock.calls.map(call => call[2])).toEqual([0, 1, 2, 3, 4, 5])
  expect(JSON.stringify(project)).toBe(before)
})
it('rejects missing/out-of-range automatic primaries before Lua while manual requests remain valid', async () => {
  const { project, tables, engine } = fixture(), send = vi.fn(), createSession = vi.fn(() => runtime.createSession())
  const handle = createRealRequestHandler(send, async () => engine, createSession)
  project.calculation.automaticOpticalConstants = true; project.scripts.enabled = true
  project.scripts.beforeCalculation = 'print("started")'
  await handle({ id: 1, kind: 'reflectivity', project, tables: [] })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('missing optical table') })
  project.experiment.energy = 90
  await handle({ id: 2, kind: 'asymmetry', project, tables })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('outside') })
  expect(createSession).not.toHaveBeenCalled()
  project.calculation.automaticOpticalConstants = false
  await handle({ id: 3, kind: 'reflectivity', project, tables: [] })
  expect(createSession).toHaveBeenCalledTimes(1)
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'result', result: { scriptMessages: ['started'] } })
})
