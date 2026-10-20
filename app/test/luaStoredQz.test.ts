import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createBeforeCalculation } from '../src/compute/lua/beforeCalculation'
import { calculateRealCurve, type RealCalculationEngine } from '../src/model/realCalculation'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import type { OpticalTable } from '../src/import/tables'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
function fixture() {
  const project = createDefaultProject()
  project.experiment.energy = 90; project.experiment.qzScan.points = 2; project.experiment.qzScan.qzMax = .02
  project.sample.layers = [createLayer({ opticalTable: 'A', delta: .01, dielectricTensor: { values: Array(18).fill(9), anisotropic: true } }), createLayer()]
  project.sample.elementProfiles = [{ element: 'Fe', f1: 1, f2: 2, f1Mag: 0, f2Mag: 0, slabs: [], scatteringTensor: Array(18).fill(8) }]
  project.calculation.algorithm = 'matrix'; project.calculation.automaticOpticalConstants = true
  const engine: RealCalculationEngine = { calculate: vi.fn(request => new Float64Array(request.qz.length * 2).fill(1)),
    energyScan: vi.fn(), zakQz: vi.fn(request => new Float64Array(request.qz.length * 2).fill(1)), zakEnergy: vi.fn(),
    matrixQz: vi.fn(request => new Float64Array(request.qz.length * 2).fill(1)), matrixEnergy: vi.fn(),
    dielectricTensor: vi.fn(() => ({ values: new Float64Array(18).fill(3), anisotropic: false })),
    scatteringTensor: () => new Float64Array(18).fill(4),
    lookup: vi.fn((_table, _energy, cursor) => ({ values: new Float64Array([.02, .003]), cursor: cursor + 1 })) }
  const tables: OpticalTable[] = [{ name: 'A', kind: 'db', energy: [120, 180], columns: [], warnings: [] }]
  return { project, engine, tables }
}
it('packs retained matrix overrides, replaces them on refresh and rebuilds manual requests', () => {
  const { project, engine, tables } = fixture(), before = JSON.stringify(project)
  const result = calculateRealCurve(project, tables, engine, 'qz', 'monochromatic')
  expect(vi.mocked(engine.matrixQz).mock.calls[0][0].layers[0]).toMatchObject({ anisotropic: 1, values: [0, 0, .99, 0, ...Array(18).fill(9)] })
  expect(result.opticalState.scatteringTensors![0][0]).toBe(8)
  result.opticalState.dielectricTensors[0]![0] = 17
  expect(JSON.stringify(project)).toBe(before)
  project.experiment.energy = 150
  calculateRealCurve(project, tables, engine, 'qz', 'monochromatic')
  expect(vi.mocked(engine.matrixQz).mock.calls[1][0].layers[0]).toMatchObject({ anisotropic: 0, values: [0, 0, .98, .003, ...Array(18).fill(3)] })
  project.calculation.automaticOpticalConstants = false
  calculateRealCurve(project, [], engine, 'qz', 'monochromatic')
  expect(vi.mocked(engine.matrixQz).mock.calls[2][0].layers[0].anisotropic).toBe(0)
  expect(vi.mocked(engine.matrixQz).mock.calls[2][0].layers[0].values.slice(4)).toEqual(Array(18).fill(3))
})
it.each(['parratt', 'zak', 'matrix'] as const)('keeps serial Lua state ahead of the saved JSON snapshot in %s qz requests', async algorithm => {
  const { project, engine, tables } = fixture()
  project.calculation.algorithm = algorithm; project.scripts.enabled = true
  project.sample.layers[1].thickness = 7
  project.scripts.beforeCalculation = 'exx_r[0] = exx_r[0] + 1; thickness[1] = thickness[1] + 3; print(exx_r[0])'
  const before = JSON.stringify(project), session = await runtime.createSession(), messages: string[] = []
  try {
    const hook = createBeforeCalculation(session, engine, tables, text => messages.push(text))
    const first = calculateRealCurve(project, tables, engine, 'qz', 'dichroic', undefined, hook)
    const second = calculateRealCurve(first.scriptedProject!, tables, engine, 'qz', 'dichroic', first.opticalState, hook)
    expect(messages).toEqual(['10', '11'])
    expect(first.opticalState.layerDepths).toEqual([0, 7])
    expect(second.opticalState.layerDepths).toEqual([0, 7])
    expect(second.opticalState.layerDepths).not.toBe(first.opticalState.layerDepths)
    expect(second.opticalState.layers[1].thickness).toBe(13)
    expect(first.opticalState.dielectricState![0]!.values[0]).toBe(10)
    expect(second.opticalState.dielectricState![0]!.values[0]).toBe(11)
    expect(second.opticalState.scatteringTensors![0][0]).toBe(8)
    expect(JSON.stringify(project)).toBe(before)
    if (algorithm === 'matrix') {
      expect(vi.mocked(engine.matrixQz).mock.calls.map(([request]) => request.layers[0].values[4])).toEqual([10, 11])
    } else expect(engine.matrixQz).not.toHaveBeenCalled()
  } finally { session.close() }
})
it('ignores saved tensors in fresh manual Lua qz requests', async () => {
  const { project, engine } = fixture()
  project.calculation.automaticOpticalConstants = false; project.scripts.enabled = true
  project.scripts.beforeCalculation = 'assert(exx_r[0] == 3)'
  const session = await runtime.createSession()
  try {
    const result = calculateRealCurve(project, [], engine, 'qz', 'monochromatic', undefined, createBeforeCalculation(session, engine, []))
    expect(result.opticalState.dielectricState![0]!.values[0]).toBe(3)
    expect(result.opticalState.scatteringTensors![0][0]).toBe(4)
  } finally { session.close() }
})

it('preserves the stored isotropic classification instead of forcing a tensor override', () => {
  const { project, engine } = fixture()
  project.sample.layers[0].dielectricTensor!.anisotropic = false
  const result = calculateRealCurve(project, [], engine, 'qz', 'monochromatic')
  expect(result.opticalState.dielectricState![0]!.values[0]).toBe(9)
  expect(result.opticalState.dielectricTensors[0]).toBeNull()
  expect(vi.mocked(engine.matrixQz).mock.calls[0][0].layers[0].anisotropic).toBe(0)
})
