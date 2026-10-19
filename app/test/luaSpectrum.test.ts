import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createBeforeCalculation } from '../src/compute/lua/beforeCalculation'
import { createRealRequestHandler, type RealEngine } from '../src/compute/realEngine'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import { realLayerSpectrum } from '../src/model/realSpectrum'
import type { OpticalTable } from '../src/import/tables'

const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
function fixture() {
  const project = createDefaultProject(); project.experiment.energy = 150
  project.sample.layers = [createLayer({ opticalTable: 'sample', deltaMag: 5, betaMag: 8 })]
  project.scripts.enabled = true
  const tables: OpticalTable[] = [
    { name: 'sample', kind: 'db', energy: [120, 180], columns: [[1, 1], [2, 2]], warnings: [] },
    { name: 'sample', kind: 'm', energy: [100, 150, 200], columns: [[10, 10, 10], [20, 20, 20]], warnings: [] },
  ]
  const engine: RealEngine = { calculate: vi.fn(), fitError: vi.fn(), energyScan: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(),
    matrixQz: vi.fn(), matrixEnergy: vi.fn(), dielectricTensor: () => ({ values: new Float64Array(18), anisotropic: false }),
    lookup: (table, _energy, cursor) => ({ values: new Float64Array(table.kind === 'm' ? [10, 20] : [1, 2]), cursor: cursor + 1 }) }
  return { project, tables, engine }
}

it.each([false, true])('runs constructor and every spectrum point with persistent globals, partial refresh and automatic=%s', async automatic => {
  const { project, tables, engine } = fixture()
  project.calculation.automaticOpticalConstants = automatic
  project.scripts.beforeCalculation = 'calls = (calls or 0) + 1; deltam[0] = deltam[0] + calls; print(calls, ":", energy); energy = energy + 7'
  const before = structuredClone(project)
  const session = await runtime.createSession(), messages: string[] = []
  try {
    const hook = vi.fn(createBeforeCalculation(session, engine, tables, text => messages.push(text)))
    const result = realLayerSpectrum(project, { layerIndex: 0, magnetic: true, tables }, engine.lookup, undefined, hook)
    expect(result).toEqual({ energy: [100, 150, 200], first: automatic ? [13, 13, 17] : [8, 13, 17], second: automatic ? [20, 20, 20] : [8, 20, 20] })
    expect(messages).toEqual(['1:150', '2:100', '3:150', '4:200'])
    expect(hook.mock.calls.map(call => [call[2], call[3]])).toEqual(Array(4).fill([0, 'temporary']))
    expect(project).toEqual(before)
  } finally { session.close() }
})

it('streams spectrum output before a source-line failure, disposes its session and recovers on the next request', async () => {
  const { project, tables, engine } = fixture()
  project.scripts.beforeCalculation = 'print("before failure")\nerror("spectrum failure")'
  const before = structuredClone(project), send = vi.fn(), sessions = [] as Awaited<ReturnType<typeof runtime.createSession>>[]
  const handle = createRealRequestHandler(send, async () => engine, async () => {
    const session = await runtime.createSession(); vi.spyOn(session, 'close'); sessions.push(session); return session
  })
  await handle({ id: 1, kind: 'layerSpectrum', project, spectrum: { layerIndex: 0, magnetic: true, tables } })
  expect(send.mock.calls[0][0]).toEqual({ id: 1, type: 'scriptMessages', lines: ['before failure'] })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ id: 1, type: 'error' })
  expect(JSON.stringify(send.mock.calls.at(-1))).toContain('BeforeCalculation:2')
  expect(send.mock.calls.some(([message]) => message.type === 'result')).toBe(false)
  expect(sessions[0].close).toHaveBeenCalled()
  expect(project).toEqual(before)
  project.scripts.beforeCalculation = 'calls = (calls or 0) + 1; print(calls)'
  await handle({ id: 2, kind: 'layerSpectrum', project, spectrum: { layerIndex: 0, magnetic: true, tables } })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ id: 2, type: 'result', result: { scriptMessages: ['1', '2', '3', '4'] } })
  expect(sessions[1].close).toHaveBeenCalled()
})

it('refreshes imported tensor state before hooks and retains scripted tensors at skipped primary points', async () => {
  const { project, tables, engine } = fixture()
  tables.push({ name: 'sample', kind: 'e', energy: [100, 200], columns: [], warnings: [] })
  const scalarLookup = engine.lookup
  engine.lookup = (table, energy, cursor) => table.kind === 'e'
    ? { values: new Float64Array(18).fill(30), cursor: cursor + 1 } : scalarLookup(table, energy, cursor)
  project.scripts.beforeCalculation = `calls = (calls or 0) + 1
    if calls == 2 then assert(exx_r[0] == 1) end
    if calls == 3 then assert(exx_r[0] == 30) end
    if calls == 4 then assert(exx_r[0] == 3) end
    exx_r[0] = calls`
  const session = await runtime.createSession()
  try {
    const hook = createBeforeCalculation(session, engine, tables)
    expect(realLayerSpectrum(project, { layerIndex: 0, magnetic: true, tables }, engine.lookup, undefined, hook).first).toEqual([5, 10, 10])
    expect(session.getGlobal('calls')).toBe(4)
  } finally { session.close() }
})
