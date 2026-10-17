import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createScriptArrayWorkspace } from '../src/model/scriptArrays'
import { createScriptFactorLookup } from '../src/model/scriptFactors'
import { createDefaultProject } from '../src/model/defaults'
import type { OpticalTable } from '../src/import/tables'
import type { RealTableLookup } from '../src/model/refreshOpticalConstants'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
const table = (name: string, kind: 'ff' | 'ffm', energy = [100, 200]): OpticalTable =>
  ({ name, kind, energy, columns: [[1, 2], [3, 4]], warnings: [] })
function workspace() {
  const project = createDefaultProject()
  project.sample.elementProfiles = ['Fe', 'Ni'].map(element => ({ element, f1: 26, f2: 1, f1Mag: 2, f2Mag: 3, slabs: [] }))
  return createScriptArrayWorkspace(project)
}
it('uses supplied energy, native cursors and shared arrays, preserving missing/out-of-range factors', async () => {
  const state = workspace(), cursors = new Map<OpticalTable, number>()
  const primary = table('Fe', 'ff'), magnetic = table('Fe', 'ffm', [120, 180])
  const lookup = vi.fn<RealTableLookup>((source, energies, cursor) => ({
    values: new Float64Array(source === primary ? [energies[0], cursor] : energies[0] < 120 ? [0, 0] : [4, 5]), cursor: cursor + 1,
  }))
  const session = await runtime.createSession()
  try {
    session.installArrays(state.arrays)
    session.installElements(state.elements, createScriptFactorLookup([primary, magnetic], lookup, cursors))
    session.execute('Fe:setf(99); Ni:setf(150); assert(f1[0] == 26 and f1[1] == 26)', 'Default')
    expect(lookup).not.toHaveBeenCalled()
    session.execute('Fe:setf(150); assert(f1[0] == 150 and Fe:getf1m() == 4); Fe:setf(100)', 'Default')
    expect(state.snapshot().sample.elementProfiles[0]).toMatchObject({ f1: 100, f2: 1, f1Mag: 0, f2Mag: 0 })
    expect(lookup.mock.calls.map(call => [call[1][0], call[2]])).toEqual([[150, 0], [150, 0], [100, 1], [100, 1]])
    session.execute('Fe:setf(201); assert(f1[0] == 100)', 'Default')
    expect(lookup).toHaveBeenCalledTimes(4)
  } finally { session.close() }
})
it('zeros absent magnetic factors, matches exact names, and avoids partial writes on lookup failure', () => {
  const state = workspace()
  const lookup = vi.fn<RealTableLookup>(() => ({ values: new Float64Array([8, 9]), cursor: 0 }))
  createScriptFactorLookup([table('Fe.ff', 'ff')], lookup)(state.elements[0], 150)
  expect(lookup).not.toHaveBeenCalled()
  createScriptFactorLookup([table('Fe', 'ff')], lookup)(state.elements[0], 150)
  expect(state.snapshot().sample.elementProfiles[0]).toMatchObject({ f1: 8, f2: 9, f1Mag: 0, f2Mag: 0 })
  const before = state.snapshot()
  createScriptFactorLookup([table('Fe', 'ff', [])], lookup)(state.elements[0], 150)
  expect(state.snapshot()).toEqual(before)
  const malformed: RealTableLookup = source => ({ values: new Float64Array(source.kind === 'ff' ? [4, 5] : [NaN, 0]), cursor: 0 })
  expect(() => createScriptFactorLookup([table('Fe', 'ff'), table('Fe', 'ffm')], malformed)(state.elements[0], 150)).toThrow('Invalid')
  expect(state.snapshot()).toEqual(before)
})
