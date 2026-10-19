import { installScriptOutput } from './output'
import { installProjectFunctions, type ScriptProjectFunctions } from './functions'
import type { ScriptFactorLookup } from '../../model/scriptFactors'
import { LuaFactory, type LuaEngine } from 'wasmoon'
import type { ScriptHookState } from '../../model/scriptHookState'
import type { ScriptNumericArray, ScriptElementBinding } from '../../model/scriptArrays'
import { installScriptArrays } from './arrays'
import { installScriptElements } from './elements'

/** A calculation-owned VM. Never share a session between independent requests. */
export class LuaSession {
  private engine: LuaEngine | undefined
  private compiled = false
  private executionDepth = 0
  private closeRequested = false

  constructor(engine: LuaEngine) {
    this.engine = engine
  }

  private activeEngine(): LuaEngine {
    if (!this.engine || this.closeRequested) throw new Error('Lua session is closed')
    return this.engine
  }

  installArrays(arrays: ReadonlyMap<string, ScriptNumericArray>, dynamicMaximumIndex?: () => number): void {
    try { installScriptArrays(this.activeEngine().global, arrays, dynamicMaximumIndex) } catch (error) {
      this.close()
      throw error
    }
  }

  installElements(elements: readonly ScriptElementBinding[], lookupFactors?: ScriptFactorLookup): void {
    try { installScriptElements(this.activeEngine().global, elements, lookupFactors) } catch (error) {
      this.close()
      throw error
    }
  }

  installProjectFunctions(project: ScriptProjectFunctions): void {
    try { installProjectFunctions(this.activeEngine().global, project) } catch (error) {
      this.close()
      throw error
    }
  }

  installOutput(emit: (message: string) => void): void {
    try { installScriptOutput(this.activeEngine().global, emit) } catch (error) {
      this.close()
      throw error
    }
  }

  setGlobal(name: string, value: unknown): void {
    this.activeEngine().global.set(name, value)
  }

  getGlobal(name: string): unknown {
    return this.activeEngine().global.get(name)
  }

  /** Each legacy CScript instance owns one Default or BeforeCalculation program. */
  compile(source: string, name: 'Default' | 'BeforeCalculation'): void {
    const engine = this.activeEngine()
    const stackTop = engine.global.getTop()
    try {
      // A Lua chunk is itself a function; avoid wrapper lines in user diagnostics.
      engine.global.loadString(source, `@${name}`)
      engine.global.lua.lua_setglobal(engine.global.address, 'Start')
      this.compiled = true
    } catch (error) {
      this.close()
      throw error
    } finally {
      if (this.engine) engine.global.setTop(stackTop)
    }
  }

  runHook(state: Readonly<ScriptHookState>): ScriptHookState {
    const engine = this.activeEngine()
    if (!this.compiled) throw new Error('Lua script has not been compiled')
    const global = engine.global
    const stackTop = global.getTop()
    this.executionDepth++
    try {
      for (const [name, value] of [['energy', state.energy], ['epsilon', state.epsilon],
        ['resolution', state.resolution], ['energyscan_qz', state.energyScanQz],
        ['renewocs', state.renewOpticalConstants]] as const) {
        if (!Number.isFinite(value)) throw new Error(`Invalid script input ${name}`)
        global.lua.lua_pushnumber(global.address, value)
        global.lua.lua_setglobal(global.address, name)
      }
      // Resolve Start each time, as legacy does; scripts can replace their entry function.
      global.lua.lua_getglobal(global.address, 'Start')
      global.runSync()
      this.activeEngine() // A caught nested failure must not publish partial state.
      global.setTop(stackTop)
      const read = (name: string) => {
        global.lua.lua_getglobal(global.address, name)
        try {
          if (!global.lua.lua_isnumber(global.address, -1)) throw new Error(`Script global ${name} must be numeric`)
          const value = global.lua.lua_tonumberx(global.address, -1, null)
          if (!Number.isFinite(value)) throw new Error(`Script global ${name} must be finite`)
          return value
        } finally { global.pop() }
      }
      return { energy: read('energy'), epsilon: read('epsilon'), resolution: read('resolution'),
        energyScanQz: read('energyscan_qz'), renewOpticalConstants: 0 }
    } catch (error) {
      this.close()
      throw error
    } finally {
      this.finishExecution(engine, stackTop)
    }
  }

  /** Synchronous execution also works inside native optimizer callbacks. */
  execute(source: string, name: 'Default' | 'BeforeCalculation'): void {
    const engine = this.activeEngine()
    const stackTop = engine.global.getTop()
    this.executionDepth++
    try {
      // No wrapper lines: Lua diagnostics refer to the user's actual source line.
      engine.global.loadString(source, `@${name}`)
      engine.global.runSync()
      this.activeEngine()
    } catch (error) {
      // A failed script may have changed globals; never reuse that partial state.
      this.close()
      throw error
    } finally {
      this.finishExecution(engine, stackTop)
    }
  }

  private finishExecution(engine: LuaEngine, stackTop: number): void {
    try { engine.global.setTop(stackTop) } finally {
      this.executionDepth--
      if (this.closeRequested && this.executionDepth === 0) this.close()
    }
  }

  close(): void {
    this.closeRequested = true
    // lua_close cannot run while a Lua -> JS -> Lua call is still unwinding.
    if (this.executionDepth > 0) return
    const engine = this.engine
    this.engine = undefined
    engine?.global.close()
  }
}

/** Require an explicit asset location: Wasmoon's default browser URL uses a CDN. */
export function createLuaRuntime(wasmLocation: string) {
  if (!wasmLocation.trim()) throw new Error('A local Lua WASM asset location is required')
  const factory = new LuaFactory(wasmLocation)
  return {
    async createSession(): Promise<LuaSession> {
      return new LuaSession(await factory.createEngine({ injectObjects: false }))
    },
  }
}
