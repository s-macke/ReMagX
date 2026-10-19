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

it('supports reentrant hooks with shared globals and restores the callback stack', async () => {
  const engine = await new LuaFactory(wasmPath).createEngine()
  const session = new LuaSession(engine)
  const input = { energy: 700, epsilon: 1e-8, resolution: .01, energyScanQz: .1, renewOpticalConstants: 0 }
  try {
    session.setGlobal('nestedHook', () => session.runHook({ ...input, energy: 640 }).energy)
    session.compile(`calls = (calls or 0) + 1
      if calls % 2 == 1 then
        energy = 900
        local value = nestedHook()
        assert(value == 641 and energy == 641)
      else
        energy = energy + 1
      end
      return "ignored", 42`, 'BeforeCalculation')
    for (let iteration = 0; iteration < 20; iteration++) {
      expect(session.runHook(input).energy).toBe(641)
      expect(engine.global.getTop()).toBe(0)
    }
    expect(session.getGlobal('calls')).toBe(40)
  } finally { session.close() }
})

it.each([false, true])('defers disposal until nested failure unwinds, even if Lua catches it (%s)', async caught => {
  const engine = await new LuaFactory(wasmPath).createEngine()
  const session = new LuaSession(engine)
  let aliveAfterFailure = false
  session.setGlobal('nestedFailure', () => {
    try { session.execute('local value = 1\nerror("nested failure")', 'BeforeCalculation') }
    finally { aliveAfterFailure = !engine.global.isClosed() }
  })
  expect(() => session.execute(caught ? 'pcall(nestedFailure)' : 'nestedFailure()', 'Default'))
    .toThrow(caught ? /closed/ : /BeforeCalculation:2:.*nested failure/)
  expect(aliveAfterFailure).toBe(true)
  expect(engine.global.isClosed()).toBe(true)
  expect(() => session.getGlobal('energy')).toThrow('closed')
  session.close()
  const replacement = await runtime.createSession()
  try { replacement.execute('value = 42', 'Default'); expect(replacement.getGlobal('value')).toBe(42) }
  finally { replacement.close() }
})

it('defers explicit callback disposal until the outer hook returns', async () => {
  const engine = await new LuaFactory(wasmPath).createEngine()
  const session = new LuaSession(engine)
  let aliveAfterClose = false
  session.setGlobal('dispose', () => { session.close(); session.close(); aliveAfterClose = !engine.global.isClosed() })
  session.compile('dispose()', 'BeforeCalculation')
  expect(() => session.runHook({ energy: 700, epsilon: 1e-8, resolution: 0, energyScanQz: .1, renewOpticalConstants: 0 }))
    .toThrow('closed')
  expect(aliveAfterClose).toBe(true)
  expect(engine.global.isClosed()).toBe(true)
})


it('creates synchronous isolated child VMs from a running hook using the local loaded module', async () => {
  const parent = await runtime.createSession()
  let executions = 0
  parent.setGlobal('nested', () => {
    const child = parent.createChildSession()
    try {
      expect(child.getGlobal('counter')).toBeNull()
      expect(child.getGlobal('parentOnly')).toBeNull()
      child.execute('counter = 1; childOnly = 99', 'BeforeCalculation')
      const grandchild = child.createChildSession()
      try {
        expect(grandchild.getGlobal('childOnly')).toBeNull()
        grandchild.execute('value = 7', 'Default')
        expect(grandchild.getGlobal('value')).toBe(7)
      } finally { grandchild.close() }
      executions++
      return child.getGlobal('counter')
    } finally { child.close() }
  })
  try {
    parent.execute('parentOnly = 42; counter = 100; assert(nested() == 1); assert(nested() == 1); assert(counter == 100)', 'Default')
    expect(executions).toBe(2)
    expect(parent.getGlobal('childOnly')).toBeNull()
  } finally { parent.close() }
  expect(() => parent.createChildSession()).toThrow('closed')
})

it('isolates failed child disposal from a parent that explicitly handles the failure', async () => {
  const parent = await runtime.createSession()
  parent.setGlobal('nestedFailure', () => {
    const child = parent.createChildSession()
    try { child.execute('local x = 1\nerror("child failure")', 'BeforeCalculation') }
    finally { child.close() }
  })
  try {
    parent.execute('local ok, message = pcall(nestedFailure); assert(not ok); assert(string.find(tostring(message), "BeforeCalculation:2:")); retained = 42', 'Default')
    expect(parent.getGlobal('retained')).toBe(42)
    const child = parent.createChildSession()
    parent.close()
    // Closing a parent cannot close an independently owned child VM.
    try { child.execute('value = 9', 'Default'); expect(child.getGlobal('value')).toBe(9) }
    finally { child.close() }
  } finally { parent.close() }
})
