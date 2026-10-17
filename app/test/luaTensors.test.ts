import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createScriptTensorWorkspace } from '../src/model/scriptTensors'
import { prepareVisnovskyLayers } from '../src/model/visnovskyRequest'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
const fixture = () => [
  { values: Float64Array.from({ length: 18 }, (_, index) => index + .25), anisotropic: false },
  { values: new Float64Array(18).fill(2), anisotropic: false },
]

it('maps all tensor components and IDs, and marks only accessed layers anisotropic', async () => {
  const initial = fixture()
  const workspace = createScriptTensorWorkspace(initial)
  const session = await runtime.createSession()
  try {
    session.installArrays(workspace.arrays)
    session.execute(`
      local names = {"xx", "xy", "xz", "yx", "yy", "yz", "zx", "zy", "zz"}
      for i, name in ipairs(names) do
        local real = _G["e" .. name .. "_r"]
        local imaginary = _G["e" .. name .. "_i"]
        assert(real[0] == 2*(i-1) + 0.25)
        assert(imaginary[0] == 2*(i-1) + 1.25)
        assert(array.size(real) == 1)
        array.new(1, 14+i)[0] = 100+i
        array.new(1, 24+i)[0] = -100-i
        assert(real[0] == 100+i and imaginary[0] == -100-i)
      end
    `, 'BeforeCalculation')
    expect(workspace.snapshot().map(tensor => tensor.anisotropic)).toEqual([true, false])
    expect(Array.from(workspace.snapshot()[0].values)).toEqual([101, -101, 102, -102, 103, -103,
      104, -104, 105, -105, 106, -106, 107, -107, 108, -108, 109, -109])
    expect(initial).toEqual(fixture())
    expect(workspace.arrays.size).toBe(18)
    expect(() => session.execute('local value = array.new(1, 24)', 'Default')).toThrow('type 24 not supported yet')
  } finally { session.close() }
})

it('preserves read side effects, live aliases and matrix override semantics', async () => {
  const workspace = createScriptTensorWorkspace(fixture())
  const session = await runtime.createSession()
  try {
    session.installArrays(workspace.arrays)
    expect(workspace.overrides()).toEqual([null, null])
    session.execute('saved = exy_i; local value = saved[0]', 'Default')
    expect(workspace.snapshot()[0].anisotropic).toBe(true)
    const prepared = prepareVisnovskyLayers([[0, 0, .01, .001, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]], 0, 0,
      () => ({ values: new Float64Array(18), anisotropic: false }), workspace.overrides())
    expect(prepared.map(layer => layer.anisotropic)).toEqual([1, 0])
    expect(prepared[0].values.slice(4)).toEqual(Array.from(fixture()[0].values))
    const refreshed = fixture(); refreshed[0].values[3] = 42
    workspace.replace(refreshed)
    expect(workspace.snapshot()[0].anisotropic).toBe(false)
    session.execute('assert(saved[0] == 42)', 'Default')
    expect(workspace.snapshot()[0].anisotropic).toBe(true)
    const copy = workspace.overrides(); copy[0]![3] = 999
    expect(workspace.snapshot()[0].values[3]).toBe(42)
    const invalid = fixture(); invalid[1].values[0] = NaN
    expect(() => workspace.replace(invalid)).toThrow('Invalid')
    expect(() => workspace.replace([])).toThrow('layer count')
    expect(workspace.snapshot()[0].values[3]).toBe(42)
  } finally { session.close() }
})

it('rejects invalid accesses without changing untouched tensor flags', async () => {
  const workspace = createScriptTensorWorkspace(fixture())
  const session = await runtime.createSession()
  try {
    session.installArrays(workspace.arrays)
    session.execute(`
      assert(not pcall(function() exx_r[0] = math.huge end))
      assert(not pcall(function() return exx_r[2] end))
    `, 'Default')
    expect(workspace.overrides()).toEqual([null, null])
  } finally { session.close() }
})
