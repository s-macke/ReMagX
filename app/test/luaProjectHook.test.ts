import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { runProjectHook } from '../src/compute/lua/projectHook'
import { createScriptArrayWorkspace } from '../src/model/scriptArrays'
import { createDefaultProject } from '../src/model/defaults'
import { HC_EV_ANGSTROM } from '../src/model/units'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))

it('refreshes project values behind existing userdata while retaining compiled script globals', async () => {
  const source = createDefaultProject()
  source.scripts.parameters = [1]
  source.sample.elementProfiles = [{ element: 'Fe', f1: 26, f2: 1, f1Mag: 0, f2Mag: 0,
    slabs: [{ thickness: 10, roughness: 0, density: 3 }] }]
  const before = JSON.stringify(source), workspace = createScriptArrayWorkspace(source)
  const session = await runtime.createSession()
  try {
    session.installArrays(workspace.arrays); session.installElements(workspace.elements)
    session.compile('calls = (calls or 0) + 1; par[0] = par[0] + calls; Fe:setf1(Fe:getf1()+1); Fe:setthickness(0, Fe:getthickness(0)+1); energy = energy + .125; epsilon = .002; resolution = .03; energyscan_qz = .4; seenRenew = renewocs', 'BeforeCalculation')
    const first = runProjectHook(session, workspace)
    expect(first.scripts.parameters).toEqual([2])
    expect(first.experiment.energy).toBe(HC_EV_ANGSTROM / (HC_EV_ANGSTROM / (HC_EV_ANGSTROM / (HC_EV_ANGSTROM / source.experiment.energy) + .125)))
    expect(first.experiment.resolution.angularFwhm).toBe(.03)
    expect(first.calculation.epsilon).toBe(.002)
    expect(first.experiment.energyScan.qz).toBe(.4)
    first.scripts.parameters[0] = 10
    first.sample.elementProfiles[0].f1 = 40
    first.sample.elementProfiles[0].slabs[0].thickness = 20
    workspace.replace(first, 1)
    const second = runProjectHook(session, workspace)
    expect(second.scripts.parameters).toEqual([12])
    expect(second.sample.elementProfiles[0]).toMatchObject({ f1: 41, slabs: [{ thickness: 21 }] })
    expect(session.getGlobal('seenRenew')).toBe(1)
    expect(workspace.beginHook().renewOpticalConstants).toBe(0)
    expect(JSON.stringify(source)).toBe(before)
    expect(first.sample.elementProfiles[0].f1).toBe(40)
  } finally { session.close() }
})

it('rejects changed userdata structure atomically and disposes invalid hook output', async () => {
  const source = createDefaultProject(), workspace = createScriptArrayWorkspace(source)
  const changed = structuredClone(source); changed.sample.layers.pop()
  expect(() => workspace.replace(changed)).toThrow('structure changed')
  expect(workspace.snapshot()).toEqual(source)
  const session = await runtime.createSession()
  session.installArrays(workspace.arrays)
  session.compile('delta[0] = 0.1; energy = 0', 'Default')
  expect(() => runProjectHook(session, workspace)).toThrow('Invalid script result')
  expect(() => session.getGlobal('energy')).toThrow('closed')
  expect(source).toEqual(createDefaultProject())
})
