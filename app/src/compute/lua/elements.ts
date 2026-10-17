import type { ScriptFactorLookup } from '../../model/scriptFactors'
import { LuaRawResult, LuaTypeExtension, type Decoration, type LuaGlobal, type LuaThread } from 'wasmoon'
import type { ScriptElementBinding } from '../../model/scriptArrays'
import { callback, numericArgument } from './arrays'

class ElementHandle {
  readonly binding: ScriptElementBinding
  constructor(binding: ScriptElementBinding) { this.binding = binding }
}

// Legacy getelem has one function-static double shared by all objects and Lua states.
let scratchValue = 3.14

class ElementExtension extends LuaTypeExtension<ElementHandle> {
  private readonly garbageCollector: number
  constructor(global: LuaGlobal) {
    super(global, 'ElementObject')
    this.garbageCollector = global.lua.module.addFunction((state: number) => {
      const pointer = global.lua.luaL_testudata(state, 1, this.name)
      if (pointer) global.lua.unref(global.lua.module.getValue(pointer, '*'))
      return 0
    }, 'ii')
    global.lua.luaL_newmetatable(global.address, this.name)
    global.lua.lua_pushcclosure(global.address, this.garbageCollector, 0)
    global.lua.lua_setfield(global.address, -2, '__gc')
    global.pop()
  }
  override pushValue(thread: LuaThread, value: Decoration<ElementHandle>): boolean {
    return value.target instanceof ElementHandle && super.pushValue(thread, value)
  }
  close(): void { this.thread.lua.module.removeFunction(this.garbageCollector) }
}

// Element methods use a C double-to-int assignment, unlike array luaL_checkint.
function elementIndex(thread: LuaThread, argument: number): number {
  const value = Math.trunc(numericArgument(thread, argument))
  if (!Number.isSafeInteger(value)) throw new Error('Element index out of range')
  return value
}

export function installScriptElements(global: LuaGlobal, elements: readonly ScriptElementBinding[], lookupFactors?: ScriptFactorLookup): void {
  const extension = new ElementExtension(global)
  global.registerTypeExtension(10, extension)
  const binding = (thread: LuaThread) => extension.getValue(thread, 1).binding
  function number(thread: LuaThread, value: number) {
    thread.lua.lua_pushnumber(thread.address, value)
    return new LuaRawResult(1)
  }
  global.lua.luaL_getmetatable(global.address, extension.name)
  function method(name: string, action: (thread: LuaThread) => LuaRawResult | void) {
    global.pushValue(callback(action))
    global.lua.lua_setfield(global.address, -2, name)
  }
  method('new', thread => {
    const index = elementIndex(thread, 1)
    if (index < 0 || index >= elements.length) throw new Error('Element index out of range')
    thread.pushValue(new ElementHandle(elements[index]))
    return new LuaRawResult(1)
  })
  for (const [name, field] of [['f1', 'f1'], ['f2', 'f2'], ['f1m', 'f1Mag'], ['f2m', 'f2Mag']] as const) {
    method(`get${name}`, thread => number(thread, binding(thread).getFactor(field)))
    method(`set${name}`, thread => { binding(thread).setFactor(field, numericArgument(thread, 2)) })
  }
  for (const [name, field] of [['sigma', 'roughness'], ['thickness', 'thickness'], ['density', 'density']] as const) {
    method(`get${name}`, thread => number(thread, binding(thread).getSlab(elementIndex(thread, 2), field)))
    method(`set${name}`, thread => { binding(thread).setSlab(elementIndex(thread, 2), field, numericArgument(thread, 3)) })
  }
  method('setf', thread => {
    const element = binding(thread), energy = numericArgument(thread, 2)
    if (!lookupFactors) throw new Error('element.setf: native table lookup is not available')
    lookupFactors(element, energy)
  })
  method('get', thread => { binding(thread); return number(thread, scratchValue) })
  method('set', thread => { const value = numericArgument(thread, 3); binding(thread); scratchValue = value })
  // Legacy element is the metatable itself, supporting both element.getf1(Fe) and Fe:getf1().
  global.lua.lua_pushvalue(global.address, -1)
  global.lua.lua_setfield(global.address, -2, '__index')
  global.lua.lua_setglobal(global.address, 'element')
  for (const element of elements) global.set(element.name, new ElementHandle(element))
}
