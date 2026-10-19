import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createRealRequestHandler, type RealEngine } from '../src/compute/realEngine'
import { prepareStandaloneFit } from '../src/model/standaloneFit'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import type { OpticalTable } from '../src/import/tables'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
function fixture(automatic: boolean, energy: boolean) {
  const project = createDefaultProject()
  project.experiment.energy = 150; project.experiment.qzScan.points = 2
  project.calculation.automaticOpticalConstants = automatic
  project.sample.layers = [createLayer({ opticalTable: 'A', delta: .01,
    dielectricTensor: { values: Array(18).fill(9), anisotropic: true } }), createLayer({ opticalTable: 'A' })]
  project.sample.elementProfiles = [{ element: 'Fe', f1: 1, f2: 2, f1Mag: 0, f2Mag: 0, slabs: [], scatteringTensor: Array(18).fill(8) }]
  project.datasets = [{ title: '', comment: '', sourceFile: '', active: true, errorWeight: 1, energy: 150,
    energyShift: 0, qzShift: 0, angularResolution: 0, intensityScale: 1, intensityOffset: 0,
    polarization: project.experiment.polarization, columns: { qz: [.01], reflectivity: [1], ...(energy ? { energy: [150] } : {}) } }]
  project.activeDatasetIndex = 0; project.fit.algorithm = 'simplex'; project.fit.occamQ = 0
  project.fit.parameters = [{ target: 'thickness', index: 0, elementIndex: null, value: 0, step: 0, lowerBound: 0, upperBound: 0 }]
  const tables: OpticalTable[] = [{ name: 'A', kind: 'db', energy: [100, 200], columns: [], warnings: [] }]
  const engine: RealEngine = { calculate: request => new Float64Array(request.qz.length * 2).fill(1),
    fitError: () => ({ error: 0, accepted: 1 }), minimize: vi.fn(), zakQz: vi.fn(), matrixQz: vi.fn(),
    energyScan: request => new Float64Array(request.energy.length * 2).fill(1), zakEnergy: vi.fn(), matrixEnergy: vi.fn(),
    dielectricTensor: request => ({ values: new Float64Array(18).fill(request.layer[2]), anisotropic: false }),
    scatteringTensor: () => new Float64Array(18).fill(4),
    lookup: vi.fn((_table, _energy, cursor) => ({ values: new Float64Array([.02, .003]), cursor: cursor + 1 })) }
  return { project, tables, engine }
}
it.each([[false, false, 0], [true, false, 4], [false, true, 2], [true, true, 6]] as const)(
  'preserves fit preparation order for automatic=%s energy=%s', (automatic, energy, lookups) => {
    const { project, tables, engine } = fixture(automatic, energy), before = JSON.stringify(project)
    const prepared = prepareStandaloneFit(project, tables, engine)
    expect(prepared.project.sample.layers[0].delta).toBe(automatic || energy ? .02 : .01)
    expect(vi.mocked(engine.lookup).mock.calls.map(call => call[2])).toEqual(Array.from({ length: lookups }, (_, index) => index))
    expect(prepared.opticalState.scatteringTensors![0][0]).toBe(automatic ? 8 : 4)
    expect(JSON.stringify(project)).toBe(before)
  })
it.each([[false, false], [true, false], [false, true], [true, true]] as const)(
  'supplies prepared state to the first fit Lua hook for automatic=%s energy=%s', async (automatic, energy) => {
    const { project, tables, engine } = fixture(automatic, energy)
    project.scripts.enabled = true
    const expected = automatic || energy ? .02 : .01
    project.scripts.beforeCalculation = `calls = (calls or 0) + 1; if calls == 1 then assert(delta[0] == ${expected} and exx_r[0] == ${expected}); print("initialized") end`
    const before = JSON.stringify(project), send = vi.fn()
    await createRealRequestHandler(send, async () => engine, () => runtime.createSession())({ id: 1, kind: 'fit', project, tables })
    expect(send.mock.calls[0][0]).toEqual({ id: 1, type: 'scriptMessages', lines: ['initialized'] })
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'result', result: { scriptMessages: ['initialized'], chi2: 0 } })
    expect(JSON.stringify(project)).toBe(before)
  })
it('ignores inactive energy columns and rejects invalid active datasets and required tables before Lua', async () => {
  const { project, tables, engine } = fixture(false, false)
  const inactive = structuredClone(project.datasets[0]); inactive.active = false; inactive.columns.energy = [150]
  project.datasets.push(inactive)
  prepareStandaloneFit(project, [], engine)
  expect(engine.lookup).not.toHaveBeenCalled()
  const send = vi.fn(), createSession = vi.fn(() => runtime.createSession())
  project.scripts.enabled = true; project.scripts.beforeCalculation = 'print("must not execute")'
  const handle = createRealRequestHandler(send, async () => engine, createSession)
  project.datasets[0].columns.energy = [150]
  await handle({ id: 1, kind: 'fit', project, tables: [] })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('missing optical table') })
  project.experiment.energy = 90
  await handle({ id: 2, kind: 'fit', project, tables })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('outside') })
  project.datasets[0].columns.qz = []
  await handle({ id: 3, kind: 'fit', project, tables })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('no data') })
  project.datasets[0].active = false
  await handle({ id: 4, kind: 'fit', project, tables })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('Select at least one dataset') })
  expect(createSession).not.toHaveBeenCalled()
  expect(engine.minimize).not.toHaveBeenCalled()
})
