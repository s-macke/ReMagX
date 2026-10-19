import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createBeforeCalculation } from '../src/compute/lua/beforeCalculation'
import { createRealRequestHandler, type RealEngine } from '../src/compute/realEngine'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import { realLayerSpectrum, realScatteringFactors } from '../src/model/realSpectrum'
import type { OpticalTable } from '../src/import/tables'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
function fixture() {
  const project = createDefaultProject(); project.sample.mode = 'element'; project.experiment.energy = 150
  project.sample.layers = [createLayer({ delta: .01, thickness: 3 })]
  project.sample.elementProfiles = ['Fe', 'Co'].map(element => ({ element, f1: 7, f2: 8, f1Mag: 0, f2Mag: 0,
    slabs: [{ density: element === 'Fe' ? 2 : 1, thickness: 0, roughness: 0 }, { density: 0, thickness: 0, roughness: 0 }] }))
  project.scripts.enabled = true
  project.scripts.beforeCalculation = 'calls = (calls or 0) + 1; assert(delta[0] == 0.01 and array.size(thickness) == 0); thickness[0] = thickness[0] + 10; f1[0] = f1[0] + calls; Fe:setdensity(0, Fe:getdensity(0) + 1); FillTensors(); print(calls, ":", energy); energy = energy + 7'
  const tables: OpticalTable[] = ['Fe', 'Co'].map(name => ({ name, kind: 'ff', energy: name === 'Fe' ? [100, 150, 200] : [120, 180], columns: [], warnings: [] }))
  const engine: RealEngine = { calculate: vi.fn(), fitError: vi.fn(), energyScan: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), matrixQz: vi.fn(), matrixEnergy: vi.fn(),
    dielectricTensor: () => ({ values: new Float64Array(18), anisotropic: false }), scatteringTensor: () => new Float64Array(18),
    lookup: (table, _energy, cursor) => ({ values: new Float64Array(table.name === 'Fe' ? [20, 2] : [30, 3]), cursor: cursor + 1 }) }
  return { project, tables, engine }
}

it.each([false, true])('executes element hooks with independent stored layers/slabs and automatic=%s', async automatic => {
  const { project, tables, engine } = fixture(); project.calculation.automaticOpticalConstants = automatic
  const before = structuredClone(project)
  for (const optical of [false, true]) {
    const session = await runtime.createSession(), messages: string[] = []
    try {
      const hook = vi.fn(createBeforeCalculation(session, engine, tables, text => messages.push(text)))
      const result = optical
        ? realLayerSpectrum(project, { layerIndex: 0, elementIndex: 0, magnetic: false, tables }, engine.lookup, engine.scatteringTensor, hook)
        : realScatteringFactors(project, { elementIndex: 0, tables }, engine.lookup, engine.scatteringTensor, hook)
      const term = (factor: number, density: number, energy: number) => factor * density / energy / energy * .0004151761541 * 1e6
      expect(result.first).toEqual(optical ? [100, 150, 200].map((energy, index) => term(index + 22, index + 4, energy) + term(index === 0 && !automatic ? 7 : 30, 1, energy)) : [22, 23, 24])
      expect(messages).toEqual(['1:150', '2:100', '3:150', '4:200'])
      expect(hook.mock.calls.map(call => call[3])).toEqual(Array(4).fill('temporary'))
      expect(hook.mock.results.at(-1)!.value.project.sample.layers[0].thickness).toBe(43)
      expect(hook.mock.results.at(-1)!.value.project.sample.elementProfiles[0].slabs[0].thickness).toBe(0)
    } finally { session.close() }
  }
  expect(project).toEqual(before)
})

it('skips zero-energy factor points before hooks but rejects them in optical spectra', async () => {
  const { project, tables, engine } = fixture(); tables[0].energy.unshift(0)
  const session = await runtime.createSession()
  try {
    const hook = vi.fn(createBeforeCalculation(session, engine, tables))
    expect(realScatteringFactors(project, { elementIndex: 0, tables }, engine.lookup, engine.scatteringTensor, hook).energy).toEqual([100, 150, 200])
    expect(hook).toHaveBeenCalledTimes(4)
    expect(() => realLayerSpectrum(project, { layerIndex: 0, magnetic: false, tables }, engine.lookup, engine.scatteringTensor, hook)).toThrow('positive')
  } finally { session.close() }
})

it.each(['scatteringFactors', 'layerSpectrum'] as const)('streams %s failures and disposes element script sessions', async kind => {
  const { project, tables, engine } = fixture()
  project.scripts.beforeCalculation = 'print("element failure")\nerror("failed")'
  const send = vi.fn(), session = await runtime.createSession(); const close = vi.spyOn(session, 'close')
  const handle = createRealRequestHandler(send, async () => engine, async () => session)
  await handle({ id: 1, kind, project, spectrum: { elementIndex: 0, layerIndex: 0, magnetic: false, tables } })
  expect(send.mock.calls[0][0]).toEqual({ id: 1, type: 'scriptMessages', lines: ['element failure'] })
  expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'error' })
  expect(JSON.stringify(send.mock.calls.at(-1))).toContain('BeforeCalculation:2')
  expect(send.mock.calls.some(([message]) => message.type === 'result')).toBe(false)
  expect(close).toHaveBeenCalled()
})
