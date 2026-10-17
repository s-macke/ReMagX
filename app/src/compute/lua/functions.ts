import type { LuaGlobal } from 'wasmoon'
import { callback } from './arrays'

export interface ScriptProjectFunctions {
  setLayerText(index: number, field: 'material' | 'opticalTable', value: string): void
}

export function installProjectFunctions(global: LuaGlobal, project: ScriptProjectFunctions): void {
  for (const [name, field] of [['SetName', 'opticalTable'], ['SetChemicalFormula', 'material']] as const) {
    global.set(name, callback(thread => {
      // Original handlers silently return unless exactly two arguments were supplied.
      if (thread.getTop() !== 2) return
      // These handlers use lua_tonumber, which converts nonnumeric arguments to zero.
      const index = Math.trunc(thread.lua.lua_tonumberx(thread.address, 1, null))
      if (!Number.isSafeInteger(index)) throw new Error(`${name}: invalid layer index`)
      const isString = thread.lua.lua_isstring(thread.address, 2)
      // SetName would construct CString(NULL); reject this undefined legacy access.
      if (!isString && field === 'opticalTable') throw new Error('SetName: string or number expected')
      const value = isString ? thread.lua.lua_tolstring(thread.address, 2, null).split('\0')[0] : ''
      project.setLayerText(index, field, value)
    }))
  }
  // Explicit deferred-feature errors required by D-22 / AC-7a, not missing globals.
  for (const name of ['KramersKronigRange', 'ShowMatrixEigenvalues', 'ShowEScanEigenvalues']) {
    global.set(name, callback(() => { throw new Error(`${name}: not supported yet`) }))
  }
}
