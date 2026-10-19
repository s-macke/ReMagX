import { LuaRawResult, type LuaGlobal } from 'wasmoon'
import { callback } from './arrays'

export interface ScriptProjectFunctions {
  gaussLorentzianImag?(center: number, area: number, width: number, mixingPercent: number): number
  gaussLorentzianReal?(center: number, area: number, width: number, mixingPercent: number): number
  fillTensors?(): void
  setDeltaBeta?(index: number, energy: number): void
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
  global.set('FillTensors', callback(() => {
    if (!project.fillTensors) throw new Error('FillTensors: native tensor construction is not available')
    project.fillTensors()
  }))
  global.set('SetDeltaBeta', callback(thread => {
    if (thread.getTop() !== 2) return
    const index = Math.trunc(thread.lua.lua_tonumberx(thread.address, 1, null))
    const energy = thread.lua.lua_tonumberx(thread.address, 2, null)
    if (!project.setDeltaBeta) throw new Error('SetDeltaBeta: native table lookup is not available')
    project.setDeltaBeta(index, energy)
  }))
  global.set('GetGaussLorentzianImag', callback(thread => {
    if (thread.getTop() !== 4) return
    if (!project.gaussLorentzianImag) throw new Error('GetGaussLorentzianImag: native line-shape calculation is not available')
    const argument = (index: number) => thread.lua.lua_tonumberx(thread.address, index, null)
    const result = project.gaussLorentzianImag(argument(1), argument(2), argument(3), argument(4))
    if (!Number.isFinite(result)) throw new Error('GetGaussLorentzianImag: nonfinite result')
    thread.lua.lua_pushnumber(thread.address, result)
    return new LuaRawResult(1)
  }))
  global.set('GetGaussLorentzianReal', callback(thread => {
    if (thread.getTop() !== 4) return
    if (!project.gaussLorentzianReal) throw new Error('GetGaussLorentzianReal: native line-shape calculation is not available')
    const argument = (index: number) => thread.lua.lua_tonumberx(thread.address, index, null)
    const result = project.gaussLorentzianReal(argument(1), argument(2), argument(3), argument(4))
    if (!Number.isFinite(result)) throw new Error('GetGaussLorentzianReal: nonfinite result')
    thread.lua.lua_pushnumber(thread.address, result)
    return new LuaRawResult(1)
  }))
  // Explicit deferred-feature errors required by D-22 / AC-7a, not missing globals.
  for (const name of ['KramersKronigRange', 'ShowMatrixEigenvalues', 'ShowEScanEigenvalues']) {
    global.set(name, callback(() => { throw new Error(`${name}: not supported yet`) }))
  }
}
