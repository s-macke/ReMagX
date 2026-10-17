import type { LuaGlobal } from 'wasmoon'
import { callback } from './arrays'

/** Legacy GUI LuaPrintMessage: concatenation, C strings and one message per call. */
export function installScriptOutput(global: LuaGlobal, emit: (message: string) => void): void {
  const stackTop = global.getTop()
  try {
    // Use Lua's printf formatter rather than approximating C %.14g in JavaScript.
    // Capture the library functions before user scripts can replace their globals.
    global.loadString(`
      local emit = ...
      local kind, select, format = type, select, string.format
      local prefix, concat = string.match, table.concat
      local protected, raise, text = pcall, error, tostring
      local function output(...)
        local parts = {}
        for i = 1, select("#", ...) do
          local value = select(i, ...)
          if kind(value) == "number" then value = format("%.14g", value)
          elseif kind(value) ~= "string" then value = "" end
          parts[i] = prefix(value, "^[^%z]*")
        end
        local ok, message = protected(emit, concat(parts))
        if not ok then raise(text(message), 2) end
      end
      print, write = output, output
    `, '@script-output')
    global.pushValue(callback(thread => {
      emit(thread.lua.lua_tolstring(thread.address, 1, null))
    }))
    global.runSync(1)
  } finally { global.setTop(stackTop) }
}
