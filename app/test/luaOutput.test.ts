import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))

it('joins legacy print/write arguments without separators and emits one entry per call', async () => {
  const messages: string[] = []
  const session = await runtime.createSession()
  try {
    session.installOutput(message => messages.push(message))
    session.execute(`
      assert(print == write)
      print("energy=", 700.0, " eV")
      write("delta=", 0.000012345678901234567)
      print("a", nil, true, false, {}, "b")
      print("before" .. string.char(0) .. "after", "tail")
      print()
      write("first\\nsecond")
      print(1.2345678901234567, ";", 1e14, ";", -0.0)
    `, 'Default')
    expect(messages).toEqual(['energy=700 eV', 'delta=1.2345678901235e-05', 'ab', 'beforetail', '',
      'first\nsecond', '1.2345678901235;1e+14;-0'])
  } finally { session.close() }
})

it('isolates output sinks and preserves captured formatting when scripts change Lua globals', async () => {
  const first: string[] = [], second: string[] = []
  const a = await runtime.createSession(), b = await runtime.createSession()
  try {
    a.installOutput(message => first.push(message)); b.installOutput(message => second.push(message))
    a.execute('type = nil; string.format = nil; table.concat = nil; print("a", 2.0)', 'Default')
    b.execute('write("b", 3.0)', 'Default')
    expect(first).toEqual(['a2']); expect(second).toEqual(['b3'])
  } finally { a.close(); b.close() }
})

it('reports output delivery errors at the user call and disposes the failed session', async () => {
  const session = await runtime.createSession()
  session.installOutput(() => { throw new Error('message delivery failed') })
  expect(() => session.execute('local x = 1\nx = x + 1\nprint(x)', 'Default')).toThrow(/Default:3:.*message delivery failed/)
  expect(() => session.getGlobal('x')).toThrow('closed')
})
