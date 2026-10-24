import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createDefaultProject } from '../src/model/defaults'
import { createScriptArrayWorkspace } from '../src/model/scriptArrays'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))

it('maps SetName to the table name and SetChemicalFormula to material without altering the project title', async () => {
  const source = createDefaultProject(), before = JSON.stringify(source)
  const workspace = createScriptArrayWorkspace(source)
  const session = await runtime.createSession()
  try {
    session.installProjectFunctions(workspace)
    session.execute(`
      SetName(0.9, "FeTable")
      SetChemicalFormula("0", "Fe2O3")
      SetName(0, "ignored", "extra")
      SetChemicalFormula(0)
    `, 'Default')
    expect(workspace.snapshot().sample.layers[0]).toMatchObject({ material: 'Fe2O3', opticalTable: 'FeTable' })
    expect(workspace.snapshot().name).toBe(source.name)
    session.execute('SetChemicalFormula(false, nil); SetName(0, "short" .. string.char(0) .. "ignored")', 'Default')
    expect(workspace.snapshot().sample.layers[0]).toMatchObject({ material: '', opticalTable: 'short' })
    expect(JSON.stringify(source)).toBe(before)
  } finally { session.close() }
})

it.each(['KramersKronigRange', 'ShowMatrixEigenvalues', 'ShowEScanEigenvalues'])(
  'gives the deferred API name and source line for %s without changing the caller project', async name => {
    const source = createDefaultProject(), before = JSON.stringify(source)
    const workspace = createScriptArrayWorkspace(source)
    const session = await runtime.createSession()
    session.installProjectFunctions(workspace)
    expect(() => session.execute(`SetName(0, "temporary")\nlocal x = 1\n${name}()`, 'BeforeCalculation'))
      .toThrow(new RegExp(`BeforeCalculation:3:.*${name}: not supported yet`))
    expect(() => session.getGlobal('SetName')).toThrow('closed')
    expect(JSON.stringify(source)).toBe(before)
  })

it.each(['SetName(-1, "bad")', 'SetName(0, nil)', 'SetChemicalFormula(10000, "bad")'])(
  'rejects undefined legacy accesses with source diagnostics: %s', async statement => {
    const session = await runtime.createSession()
    session.installProjectFunctions(createScriptArrayWorkspace(createDefaultProject()))
    expect(() => session.execute(statement, 'Default')).toThrow(/Default:1:/)
  })


it.each(['Imag', 'Real'] as const)('preserves Gauss-Lorentzian %s Lua argument conversion, arity and double return values', async part => {
  const session = await runtime.createSession()
  const calls: number[][] = []
  try {
    session.installProjectFunctions({ ...createScriptArrayWorkspace(createDefaultProject()),
      [`gaussLorentzian${part}`]: (...args: number[]) => { calls.push(args); return -0 } })
    session.execute(`assert(GetGaussLorentzian${part}(1, 2, 3) == nil)
      local value = GetGaussLorentzian${part}("640", false, nil, "50")
      assert(math.type(value) == "float" and 1/value == -math.huge)`, 'Default')
    expect(calls).toEqual([[640, 0, 0, 50]])
  } finally { session.close() }
})


it.each(['CalculateDicReflectivity', 'CalculateEnergyscan'])(
  'preserves legacy no-op %s with zero return values and unchanged state', async name => {
    const workspace = createScriptArrayWorkspace(createDefaultProject())
    const before = workspace.snapshot()
    const session = await runtime.createSession()
    try {
      session.installProjectFunctions(workspace)
      session.execute(`
        energy = 123
        local retained = {}
        assert(select("#", ${name}()) == 0)
        assert(select("#", ${name}(false, nil, "ignored", retained)) == 0)
        assert(${name}() == nil)
        assert(energy == 123)
      `, 'Default')
      expect(workspace.snapshot()).toEqual(before)
    } finally { session.close() }
  })

it('reports the excluded CalculateReflectivity command with its source line', async () => {
  const project = createDefaultProject(), before = structuredClone(project)
  const session = await runtime.createSession()
  session.installProjectFunctions(createScriptArrayWorkspace(project))
  expect(() => session.execute('local x = 1\nCalculateReflectivity()', 'Default'))
    .toThrow(/Default:2:.*CalculateReflectivity: not supported \(excluded from project scope\)/)
  expect(project).toEqual(before)
  expect(() => session.getGlobal('CalculateReflectivity')).toThrow('closed')
})
