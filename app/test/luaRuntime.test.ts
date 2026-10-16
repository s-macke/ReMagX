import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LuaFactory } from 'wasmoon'
import { LuaSession, createLuaRuntime } from '../src/compute/lua/runtime'

const wasmPath = fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url))
const runtime = createLuaRuntime(wasmPath)

describe('calculation-owned Lua runtime', () => {
  it('keeps globals between hooks while isolating independent calculations', async () => {
    const first = await runtime.createSession()
    const second = await runtime.createSession()
    try {
      first.setGlobal('energy', 700.25)
      first.execute('counter = (counter or 0) + 1; energy = energy + 0.125', 'BeforeCalculation')
      first.execute('counter = counter + 1', 'BeforeCalculation')
      expect(first.getGlobal('energy')).toBe(700.375)
      expect(first.getGlobal('counter')).toBe(2)
      expect(second.getGlobal('energy')).toBeNull()
      second.execute('version = _VERSION', 'Default')
      expect(second.getGlobal('version')).toBe('Lua 5.4')
    } finally {
      first.close()
      second.close()
    }
  })

  it.each([
    'local value = 1\nvalue = value + 1\nerror("broken calculation")',
    'local value = 1\nvalue = value + 1\nlocal = 2',
  ])('reports source line 3 and disposes failed sessions', async (source) => {
    const session = await runtime.createSession()
    expect(() => session.execute(source, 'BeforeCalculation')).toThrow(/BeforeCalculation:3:/)
    expect(() => session.getGlobal('energy')).toThrow('Lua session is closed')
    session.close()
    const replacement = await runtime.createSession()
    try {
      replacement.execute('energy = 42', 'Default')
      expect(replacement.getGlobal('energy')).toBe(42)
    } finally {
      replacement.close()
    }
  })

  it('supports synchronous bindings and repeated execution without retaining stack results', async () => {
    const engine = await new LuaFactory(wasmPath).createEngine()
    const session = new LuaSession(engine)
    const stackTop = engine.global.getTop()
    try {
      session.setGlobal('record', (value: number) => value * 2)
      for (let index = 0; index < 1000; index++) {
        session.execute('result = record(0.125); return result, "unused"', 'Default')
      }
      expect(session.getGlobal('result')).toBe(0.25)
      expect(engine.global.getTop()).toBe(stackTop)
    } finally {
      session.close()
    }
    expect(engine.global.isClosed()).toBe(true)
    expect(() => session.execute('', 'Default')).toThrow('Lua session is closed')
    session.close()
  })

  it('requires an explicit WASM asset location', () => {
    expect(() => createLuaRuntime('')).toThrow('asset location')
  })
})
