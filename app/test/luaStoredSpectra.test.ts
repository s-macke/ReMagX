import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createBeforeCalculation } from '../src/compute/lua/beforeCalculation'
import { visitCompoundSpectrum } from '../src/model/compoundSpectrum'
import { evaluateElementSpectrum } from '../src/model/elementSpectrum'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import type { RealCalculationEngine } from '../src/model/realCalculation'
import type { OpticalTable } from '../src/import/tables'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
function fixture() {
  const project = createDefaultProject()
  project.experiment.energy = 90; project.scripts.enabled = true
  project.sample.layers = [createLayer({ opticalTable: 'A', dielectricTensor: { values: Array(18).fill(9), anisotropic: true } }), createLayer()]
  project.sample.elementProfiles = [{ element: 'Fe', f1: 26, f2: 1, f1Mag: 0, f2Mag: 0, slabs: [], scatteringTensor: Array(18).fill(8) }]
  const tables: OpticalTable[] = [
    { name: 'A', kind: 'db', energy: [120, 180], columns: [], warnings: [] },
    { name: 'Fe', kind: 'ff', energy: [120, 180], columns: [], warnings: [] },
  ]
  const engine: RealCalculationEngine = { calculate: vi.fn(), energyScan: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), matrixQz: vi.fn(), matrixEnergy: vi.fn(),
    dielectricTensor: () => ({ values: new Float64Array(18).fill(3), anisotropic: false }),
    scatteringTensor: () => new Float64Array(18).fill(4),
    lookup: (_table, _energy, cursor) => ({ values: new Float64Array([1, 2]), cursor: cursor + 1 }) }
  return { project, tables, engine }
}
it.each([true, false])('seeds compound spectrum Lua from stored tensors only with automatic=%s', async automatic => {
  const { project, tables, engine } = fixture()
  project.calculation.automaticOpticalConstants = automatic
  project.scripts.beforeCalculation = 'exx_r[0] = exx_r[0] + 1; print(exx_r[0])'
  const before = JSON.stringify(project), session = await runtime.createSession(), messages: string[] = []
  try {
    const hook = createBeforeCalculation(session, engine, tables, text => messages.push(text))
    const tensors: number[] = [], inactive: number[] = []
    visitCompoundSpectrum(project, tables, [100, 150, 200], engine.lookup, (_current, state) => {
      tensors.push(state.dielectricState![0]!.values[0]); inactive.push(state.scatteringTensors![0][0])
    }, hook)
    expect(messages).toEqual(automatic ? ['10', '11', '4', '5'] : ['4', '5', '4', '5'])
    expect(tensors).toEqual(automatic ? [11, 4, 5] : [5, 4, 5])
    expect(inactive).toEqual(automatic ? [8, 8, 8] : [4, 4, 4])
    expect(JSON.stringify(project)).toBe(before)
  } finally { session.close() }
})
it.each([true, false])('seeds element spectra independently of stored compound layers with automatic=%s', async automatic => {
  const { project, tables, engine } = fixture()
  project.sample.mode = 'element'; project.calculation.automaticOpticalConstants = automatic
  project.scripts.beforeCalculation = 'print(exx_r[0]); exx_r[0] = exx_r[0] + 1'
  const before = JSON.stringify(project), session = await runtime.createSession(), messages: string[] = [], scattering: number[] = []
  try {
    const hook = createBeforeCalculation(session, engine, tables, text => messages.push(text))
    evaluateElementSpectrum(project, tables, [100, 150, 200], engine.lookup, engine.scatteringTensor!, current => [current.sample.elementProfiles[0].f1, 0],
      (current, state, renew, lifetime) => {
        scattering.push(state.scatteringTensors![0][0])
        return hook(current, state, renew, lifetime)
      })
    expect(messages).toEqual(automatic ? ['9', '10', '11', '12'] : ['3', '4', '5', '6'])
    expect(scattering).toEqual(automatic ? [8, 8, 4, 4] : [4, 4, 4, 4])
    expect(JSON.stringify(project)).toBe(before)
  } finally { session.close() }
})
