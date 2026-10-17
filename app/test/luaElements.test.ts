import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createDefaultProject } from '../src/model/defaults'
import { createScriptArrayWorkspace } from '../src/model/scriptArrays'
import { createLuaRuntime } from '../src/compute/lua/runtime'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
function fixture() {
  const project = createDefaultProject()
  project.sample.elementProfiles = ['Fe', 'Ni'].map(element => ({ element,
    f1: 26, f2: 1, f1Mag: .2, f2Mag: .3, slabs: [{ thickness: 10, roughness: 2, density: 3 }] }))
  return project
}

it('exposes element userdata methods and keeps factors shared with scalar arrays', async () => {
  const source = fixture(), before = JSON.stringify(source)
  const workspace = createScriptArrayWorkspace(source)
  const session = await runtime.createSession()
  try {
    session.installElements(workspace.elements)
    session.installArrays(workspace.arrays)
    session.execute(`
      assert(type(Fe) == "userdata" and type(element) == "table")
      assert(Fe:getf1() == 26 and element.getf2(Fe) == 1)
      Fe:setf1(12); Fe:setf2(2); Fe:setf1m(0.4); Fe:setf2m(0.5)
      assert(f1[0] == 12 and f2[0] == 2)
      f1[0] = 13; assert(Fe:getf1() == 13)
      assert(Fe:getf1m() == 0.4 and Fe:getf2m() == 0.5)
      local alias = element.new("0.9")
      alias:setsigma(0.9, 3.5); alias:setthickness(0, 20); alias:setdensity(0, -0.0)
      assert(Fe:getsigma(0) == 3.5 and Fe:getthickness(0) == 20)
      assert(1 / Fe:getdensity(0) == -math.huge)
      assert(math.type(Fe:getthickness(0)) == "float")
      assert(Ni:getthickness(0) == 10 and Ni:getf1() == 26)
      Fe:set("ignored", 7.5); assert(Ni:get("anything") == 7.5)
      Ni:set(nil, 3.14)
      for i = 1, 100 do local unused = element.new(0) end
      collectgarbage("collect"); assert(Fe:getf1() == 13)
    `, 'Default')
    expect(workspace.snapshot().sample.elementProfiles[0]).toMatchObject({ f1: 13, f2: 2, f1Mag: .4, f2Mag: .5,
      slabs: [{ thickness: 20, roughness: 3.5, density: -0 }] })
    expect(JSON.stringify(source)).toBe(before)
  } finally { session.close() }
})

it.each(['Fe:setdensity(1, 2)', 'element.new(2)', 'Fe:setf1(math.huge)', 'Fe:setf(700)', 'element.getf1({})'])(
  'reports element API failures on their source line: %s', async statement => {
    const source = fixture(), before = JSON.stringify(source)
    const workspace = createScriptArrayWorkspace(source)
    const session = await runtime.createSession()
    session.installElements(workspace.elements)
    expect(() => session.execute(`Fe:setf1(3)\nlocal x = 1\n${statement}`, 'Default')).toThrow(/Default:3:/)
    expect(() => session.getGlobal('Fe')).toThrow('closed')
    expect(JSON.stringify(source)).toBe(before)
  })
