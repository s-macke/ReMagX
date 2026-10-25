import { decorateFunction, decorateProxy, LuaRawResult, LuaTypeExtension,
  type Decoration, type LuaGlobal, type LuaThread } from 'wasmoon'
import { scriptIntegerArgument } from '../../model/scriptIntegerArgument'
import type { ScriptNumericArray } from '../../model/scriptArrays'

class ArrayHandle {
  readonly array: ScriptNumericArray
  readonly maximumIndex: number
  constructor(array: ScriptNumericArray, maximumIndex = array.maximumIndex) {
    this.array = array
    this.maximumIndex = maximumIndex
  }
}

export function numericArgument(thread: LuaThread, index: number): number {
  if (!thread.lua.lua_isnumber(thread.address, index)) throw new Error(`argument ${index}: number expected`)
  const value = thread.lua.lua_tonumberx(thread.address, index, null)
  if (!Number.isFinite(value)) throw new Error(`argument ${index}: finite number expected`)
  return value
}

// Numeric strings retain Lua 5.1 acceptance; D-50 defines integer conversion.
function integerArgument(thread: LuaThread, index: number): number {
  const value = numericArgument(thread, index)
  try { return scriptIntegerArgument(value) }
  catch { throw new Error(`argument ${index}: integer out of range`) }
}

export function callback(action: (thread: LuaThread) => LuaRawResult | void) {
  return decorateFunction((thread: LuaThread) => {
    try { return action(thread) } catch (error) {
      thread.lua.luaL_where(thread.address, 1)
      const location = thread.getValue(-1)
      thread.pop()
      throw new Error(`${location}${error instanceof Error ? error.message : String(error)}`)
    }
  }, { receiveThread: true, receiveArgsQuantity: true })
}

/** Actual userdata, so Lua's type/index behavior does not become JS proxy indexing. */
class ArrayExtension extends LuaTypeExtension<ArrayHandle> {
  private readonly garbageCollector: number
  constructor(thread: LuaGlobal) {
    super(thread, 'LuaBook.array')
    this.garbageCollector = thread.lua.module.addFunction((state: number) => {
      const pointer = thread.lua.luaL_testudata(state, 1, this.name)
      if (pointer) thread.lua.unref(thread.lua.module.getValue(pointer, '*'))
      return 0
    }, 'ii')
    thread.lua.luaL_newmetatable(thread.address, this.name)
    thread.lua.lua_pushcclosure(thread.address, this.garbageCollector, 0)
    thread.lua.lua_setfield(thread.address, -2, '__gc')
    thread.pop()
  }
  override pushValue(thread: LuaThread, value: Decoration<ArrayHandle>): boolean {
    return value.target instanceof ArrayHandle && super.pushValue(thread, value)
  }
  close(): void { this.thread.lua.module.removeFunction(this.garbageCollector) }
}

export function installScriptArrays(global: LuaGlobal, arrays: ReadonlyMap<string, ScriptNumericArray>,
  dynamicMaximumIndex: () => number = () => -1): void {
  const extension = new ArrayExtension(global)
  global.registerTypeExtension(10, extension)
  const byType = new Map([...arrays.values()].map(array => [array.typeId, array]))
  function handle(thread: LuaThread): ArrayHandle {
    return extension.getValue(thread, 1)
  }
  function index(thread: LuaThread, target: ArrayHandle): number {
    const value = integerArgument(thread, 2)
    const maximumIndex = target.maximumIndex === -1 ? dynamicMaximumIndex() : target.maximumIndex
    if (value < 0 || value > maximumIndex) throw new Error(`${target.array.name}: index out of range`)
    return value
  }
  const get = callback(thread => {
    const target = handle(thread)
    const value = target.array.read(index(thread, target))
    // Scientific values must stay doubles, including integral values and negative zero.
    thread.lua.lua_pushnumber(thread.address, value)
    return new LuaRawResult(1)
  })
  const set = callback(thread => {
    const value = numericArgument(thread, 3)
    const target = handle(thread)
    target.array.write(index(thread, target), value)
  })
  const size = callback(thread => {
    thread.lua.lua_pushnumber(thread.address, handle(thread).maximumIndex)
    return new LuaRawResult(1)
  })
  const create = callback(thread => {
    const maximumIndex = integerArgument(thread, 1)
    const typeId = integerArgument(thread, 2)
    const array = byType.get(typeId)
    if (!array) throw new Error(`array.new: type ${typeId} not supported yet`)
    thread.pushValue(new ArrayHandle(array, maximumIndex))
    return new LuaRawResult(1)
  })
  global.lua.luaL_getmetatable(global.address, extension.name)
  global.pushValue(get); global.lua.lua_setfield(global.address, -2, '__index')
  global.pushValue(set); global.lua.lua_setfield(global.address, -2, '__newindex')
  global.pop()
  global.set('array', decorateProxy({ new: create, get, set, size }, { proxy: false }))
  for (const array of arrays.values()) global.set(array.name, new ArrayHandle(array))
}
