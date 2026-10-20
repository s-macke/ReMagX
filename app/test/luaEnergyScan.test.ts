import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createBeforeCalculation } from '../src/compute/lua/beforeCalculation'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import { calculateRealCurve, type RealCalculationEngine } from '../src/model/realCalculation'
import type { PreparedEnergyScan } from '../src/model/parrattEnergyScan'
import type { OpticalTable } from '../src/import/tables'

const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))

it('initializes energy Lua once, refreshes before valid-point hooks and preserves the legacy beam-dependent energy capture', async () => {
  for (const algorithm of ['parratt', 'matrix', 'zak'] as const) for (const mode of ['monochromatic', 'dichroic'] as const) {
    const project = createDefaultProject()
    project.calculation.algorithm = algorithm
    project.calculation.automaticOpticalConstants = false
    project.experiment.energy = 640
    project.experiment.qzScan.useDatasetPoints = true
    project.sample.layers = [createLayer({ opticalTable: 'table' }), createLayer({ opticalTable: 'table', thickness: 20 }), createLayer({ opticalTable: 'table' })]
    project.datasets = [{ title: '', comment: '', sourceFile: '', active: true, errorWeight: 1,
      energy: 640, energyShift: 0, qzShift: 0, angularResolution: 0, intensityScale: 1, intensityOffset: 0,
      polarization: project.experiment.polarization, columns: { energy: [650, 900, 660], qz: [.02, .03, .04], reflectivity: [1, 1, 1] } }]
    project.activeDatasetIndex = 0
    project.scripts.enabled = true
    project.scripts.beforeCalculation = `calls = (calls or 0) + 1; print(calls, ":", energy, ":", renewocs)
      if calls > 1 then assert(delta[1] == 0.02) end
      thickness[1] = thickness[1] + calls; energy = energy + 10
      resolution = calls * 0.001; epsilon = calls * 0.00001; energyscan_qz = energyscan_qz + 0.1`
    const source = structuredClone(project)
    let captured: Pick<PreparedEnergyScan, 'pointSettings' | 'energy' | 'qz' | 'enabled' | 'energyWidth'> | undefined
    const calculate = vi.fn((request: Pick<PreparedEnergyScan, 'pointSettings' | 'energy' | 'qz' | 'enabled' | 'energyWidth'>) => {
      captured = request
      return new Float64Array(request.energy.flatMap(() => [1, 1]))
    })
    const engine: RealCalculationEngine = { calculate: vi.fn(), zakQz: vi.fn(), matrixQz: vi.fn(),
      energyScan: calculate, zakEnergy: calculate, matrixEnergy: calculate,
      lookup: (_table, _queries, cursor) => ({ values: new Float64Array([.02, 0]), cursor: cursor + 1 }),
      dielectricTensor: () => ({ values: new Float64Array(18), anisotropic: false }) }
    const tables: OpticalTable[] = [{ name: 'table', kind: 'db', energy: [600, 700], columns: [], warnings: [] }]
    const session = await runtime.createSession()
    const messages: string[] = []
    try {
      const hook = vi.fn(createBeforeCalculation(session, engine, tables, text => messages.push(text)))
      const result = calculateRealCurve(project, tables, engine, 'energy', mode, undefined, hook)
      expect(hook.mock.calls.map(call => call[3])).toEqual(['temporary', 'existing', 'existing'])
      expect(messages).toEqual(['1:640:0', '2:650:0', '3:660:0'])
      expect(captured!.energy).toEqual([650, 900, 660])
      expect(captured!.qz).toEqual([.02, .03, .04])
      expect(captured!.enabled).toEqual([1, 0, 1])
      expect(captured!.pointSettings).toEqual([
        [mode === 'monochromatic' ? 660 : 650, .002, .00002],
        [900, .002, .00002],
        [mode === 'monochromatic' ? 670 : 660, .003, 3 * .00001],
      ])
      expect(result.finalEnergy).toBe(670)
      expect(result.opticalState.layers[1].thickness).toBe(26)
      expect(result.opticalState.layerDepths).toEqual([0, 20, 20])
      expect(hook.mock.calls.map(call => call[1].layerDepths)).toEqual([[0, 20, 20], [0, 20, 20], [0, 20, 20]])
      expect(result.opticalState.cursors.get(tables[0])).toBe(6)
      expect(result.scriptedProject!.experiment.energyScan.qz).toBeCloseTo(source.experiment.energyScan.qz + .3, 14)
      expect(result.scriptedProject!.scripts.enabled).toBe(true)
      expect(project).toEqual(source)
    } finally { session.close() }
  }
})
