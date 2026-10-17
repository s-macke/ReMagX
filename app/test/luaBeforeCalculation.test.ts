import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createBeforeCalculation } from '../src/compute/lua/beforeCalculation'
import { createDefaultProject } from '../src/model/defaults'
import type { RealCalculationEngine } from '../src/model/realCalculation'
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
