import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createDefaultProject, createLayer } from '../src/model/defaults'
import { createScriptArrayWorkspace } from '../src/model/scriptArrays'
import { createScriptTensorWorkspace } from '../src/model/scriptTensors'
import { createScriptOptics } from '../src/model/scriptOptics'
import type { RealTableLookup } from '../src/model/refreshOpticalConstants'
import type { OpticalTable } from '../src/import/tables'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
const table = (name: string, kind: OpticalTable['kind']): OpticalTable => ({ name, kind, energy: [100, 200], columns: [], warnings: [] })

it('preserves SetDeltaBeta zero tensors, cached names, explicit FillTensors and live scalar/tensor aliases', async () => {
  const source = createDefaultProject(); source.sample.layers = [createLayer({ opticalTable: 'A' }), createLayer({ opticalTable: 'B' })]
  const before = JSON.stringify(source)
  const workspace = createScriptArrayWorkspace(source)
  const tensors = createScriptTensorWorkspace(source.sample.layers.map(() => ({ values: new Float64Array(18).fill(9), anisotropic: true })))
  const lookup = vi.fn<RealTableLookup>((table, _energy, cursor) => ({ values: new Float64Array(table.kind === 'e' ? 18 : 2).fill(table.name === 'A' ? .1 : .2), cursor: cursor + 1 }))
  const construct = vi.fn(() => ({ values: new Float64Array(18).fill(.8), anisotropic: false }))
  const optics = createScriptOptics(workspace, tensors, [table('A', 'db'), table('B', 'db'), table('B', 'e')], lookup, construct)
  const session = await runtime.createSession()
  try {
    session.installArrays(new Map([...workspace.arrays, ...tensors.arrays]))
    session.installProjectFunctions({ ...workspace, ...optics })
    session.execute('SetDeltaBeta(0, 150)', 'Default')
    expect(tensors.snapshot()[0]).toEqual({ values: new Float64Array(18), anisotropic: false })
    session.execute('SetName(0, "B"); SetDeltaBeta(0, 150); SetDeltaBeta(1, 150); assert(delta[0] == 0.1 and exx_r[1] == 0.2)', 'Default')
    expect(lookup.mock.calls.map(call => [call[0].name, call[0].kind, call[2]])).toEqual([['A', 'db', 0], ['A', 'db', 1], ['B', 'db', 0], ['B', 'e', 0]])
    session.execute('SetDeltaBeta(0, 99); SetDeltaBeta(0); FillTensors("ignored")', 'Default')
    expect(lookup).toHaveBeenCalledTimes(4)
    expect(construct).toHaveBeenCalledTimes(2)
    expect(construct.mock.calls[0]).toEqual([{ layer: [0, 0, .1, .1, 0, 0, 90, 90], tensor: 0, magnetic: 0 }])
    expect(tensors.snapshot().map(t => t.anisotropic)).toEqual([false, false])
    session.execute('assert(exx_r[0] == 0.8 and exx_r[1] == 0.8)', 'Default')
    expect(JSON.stringify(source)).toBe(before)
  } finally { session.close() }
})

it('keeps scalar and tensor state intact when table or constructor results are invalid', () => {
  const source = createDefaultProject(); source.sample.layers[0].opticalTable = 'A'
  const workspace = createScriptArrayWorkspace(source)
  const tensors = createScriptTensorWorkspace(source.sample.layers.map(() => ({ values: new Float64Array(18).fill(7), anisotropic: true })))
  const before = workspace.snapshot(), tensorBefore = tensors.snapshot()
  const optics = createScriptOptics(workspace, tensors, [table('A', 'db'), table('A', 'e')],
    table => ({ values: new Float64Array(table.kind === 'e' ? [NaN] : [.2, .3]), cursor: 0 }),
    () => ({ values: new Float64Array([NaN]), anisotropic: false }))
  expect(() => optics.setDeltaBeta(0, 150)).toThrow('Invalid')
  expect(() => optics.fillTensors()).toThrow('Invalid')
  expect(workspace.snapshot()).toEqual(before)
  expect(tensors.snapshot()).toEqual(tensorBefore)
})
