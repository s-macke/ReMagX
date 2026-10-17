import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import type { ScriptHookState } from '../src/model/scriptHookState'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
const state = (): ScriptHookState => ({ energy: 700, epsilon: 1e-8, resolution: .01, energyScanQz: .1, renewOpticalConstants: 1 })

it('compiles without running and exchanges double globals while retaining script globals across calls', async () => {
  const session = await runtime.createSession()
  try {
    session.compile(`
      assert(math.type(energy) == "float" and math.type(renewocs) == "float")
      calls = (calls or 0) + 1
      lastRenew = renewocs
      local localCounter = 0
      localCounter = localCounter + 1
      assert(localCounter == 1)
      energy = energy + calls
      epsilon = "0.002"
      resolution = resolution * 2
      energyscan_qz = -0.0
      renewocs = 99
      return "ignored", 42
    `, 'BeforeCalculation')
    expect(session.getGlobal('calls')).toBeNull()
    const input = state()
    const first = session.runHook(input)
    expect(first).toEqual({ energy: 701, epsilon: .002, resolution: .02, energyScanQz: -0, renewOpticalConstants: 0 })
    expect(input).toEqual(state())
    expect(session.getGlobal('lastRenew')).toBe(1)
    const second = session.runHook(first)
    expect(second.energy).toBe(703)
    expect(second.resolution).toBe(.04)
    expect(session.getGlobal('lastRenew')).toBe(0)
    expect(session.getGlobal('calls')).toBe(2)
  } finally { session.close() }
})

it('uses the mutable Start function and a fresh local scope for each invocation', async () => {
  const session = await runtime.createSession()
  try {
    session.compile('Start = function() energy = 42 end', 'Default')
    expect(session.runHook(state()).energy).toBe(700)
    expect(session.runHook(state()).energy).toBe(42)
  } finally { session.close() }
})

it('preserves line numbers for compile/runtime failures and leaves input state untouched', async () => {
  for (const source of ['local x = 1\nx = x + 1\nlocal = 3', 'local x = 1\nx = x + 1\nerror("broken hook")']) {
    const session = await runtime.createSession(), input = state()
    expect(() => { session.compile(source, 'BeforeCalculation'); session.runHook(input) }).toThrow(/BeforeCalculation:3:/)
    expect(input).toEqual(state())
    expect(() => session.getGlobal('energy')).toThrow('closed')
  }
})

it.each(['energy = nil', 'epsilon = math.huge', 'resolution = {}', 'energyscan_qz = 0/0'])(
  'rejects invalid output without publishing a partial state: %s', async source => {
    const session = await runtime.createSession(), input = state()
    session.compile(source, 'Default')
    expect(() => session.runHook(input)).toThrow(/Script global/)
    expect(input).toEqual(state())
    expect(() => session.getGlobal('energy')).toThrow('closed')
  })
