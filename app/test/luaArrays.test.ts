import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createDefaultProject } from '../src/model/defaults'
import { createScriptArrayWorkspace } from '../src/model/scriptArrays'
import { createLuaRuntime } from '../src/compute/lua/runtime'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))

it('executes legacy scalar array syntax on actual userdata with double values', async () => {
  const source = createDefaultProject()
  source.scripts.parameters = [1, 2, 3]
  const original = JSON.stringify(source)
  const workspace = createScriptArrayWorkspace(source)
  const session = await runtime.createSession()
  try {
    session.installArrays(workspace.arrays)
    session.execute(`
      assert(type(delta) == "userdata")
      assert(type(array) == "table")
      assert(array.size(par) == 2)
      for i = 0, array.size(par) do par[i] = par[i] * 2 end
      array.set(delta, "0", "0.125")
      assert(array.get(delta, 0) == 0.125)
      local alias = array.new(array.size(delta), 0)
      alias[0] = 0.25
      assert(delta[0] == 0.25)
      par[1] = 42
      assert(par[1] == 42)
      par[0] = -0.0
      assert(math.type(par[1]) == "float")
      assert(1 / par[0] == -math.huge)
      for i = 1, 100 do local unused = array.new(0, 0) end
      collectgarbage("collect")
      assert(delta[0] == 0.25)
    `, 'BeforeCalculation')
    expect(workspace.snapshot().scripts.parameters).toEqual([-0, 42, 6])
    expect(workspace.snapshot().sample.layers[0].delta).toBe(.25)
    expect(JSON.stringify(source)).toBe(original)
  } finally { session.close() }
})

it.each([
  'par[1.9] = 1', 'par[-1] = 1', 'par[2] = 1', 'par[0] = math.huge', 'array.get({}, 0)',
  'array.new(0, 6)', 'local alias = array.new(100, 34); alias[100] = 2',
])('reports binding failures at user line 3: %s', async statement => {
  const source = createDefaultProject(); source.scripts.parameters = [1]
  const original = JSON.stringify(source)
  const session = await runtime.createSession()
  session.installArrays(createScriptArrayWorkspace(source).arrays)
  expect(() => session.execute(`par[0] = 9\nlocal value = 1\n${statement}`, 'Default')).toThrow(/Default:3:/)
  expect(() => session.getGlobal('par')).toThrow('closed')
  expect(JSON.stringify(source)).toBe(original)
})


it('uses original integer conversion without rounding stored array values', async () => {
  const source = createDefaultProject(); source.scripts.parameters = [0, 0, 0]
  const workspace = createScriptArrayWorkspace(source)
  const session = await runtime.createSession()
  try {
    session.installArrays(workspace.arrays)
    session.execute(`
      local alias = array.new("2.5", "33.5")
      assert(array.size(alias) == 2)
      alias[1.8] = 1.0000000000000002
      assert(par[1.5] == 1.0000000000000002 and par[2.5] == par[2])
      par[-0.5] = -0.0
      assert(1/par[0.5] == -math.huge)
      assert(array.size(array.new(-1.5, 34)) == -2)
      assert(not pcall(array.get, par, -0.5000000000000001))
      assert(not pcall(array.new, 2147483647.5, 34))
    `, 'BeforeCalculation')
    expect(workspace.snapshot().scripts.parameters).toEqual([-0, 0, 1.0000000000000002])
    expect(source.scripts.parameters).toEqual([0, 0, 0])
  } finally { session.close() }
})
