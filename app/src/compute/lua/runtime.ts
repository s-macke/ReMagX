import { LuaFactory, type LuaEngine } from 'wasmoon'
import type { ScriptNumericArray, ScriptElementBinding } from '../../model/scriptArrays'
import { installScriptArrays } from './arrays'
import { installScriptElements } from './elements'

/** A calculation-owned VM. Never share a session between independent requests. */
export class LuaSession {
  private engine: LuaEngine | undefined

  constructor(engine: LuaEngine) {
    this.engine = engine
  }

  private activeEngine(): LuaEngine {
    if (!this.engine) throw new Error('Lua session is closed')
    return this.engine
  }

  installArrays(arrays: ReadonlyMap<string, ScriptNumericArray>, dynamicMaximumIndex?: () => number): void {
    try { installScriptArrays(this.activeEngine().global, arrays, dynamicMaximumIndex) } catch (error) {
      this.close()
      throw error
    }
  }

  installElements(elements: readonly ScriptElementBinding[]): void {
    try { installScriptElements(this.activeEngine().global, elements) } catch (error) {
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

  /** Synchronous execution also works inside native optimizer callbacks. */
  execute(source: string, name: 'Default' | 'BeforeCalculation'): void {
    const engine = this.activeEngine()
    const stackTop = engine.global.getTop()
    try {
      // No wrapper lines: Lua diagnostics refer to the user's actual source line.
      engine.global.loadString(source, `@${name}`)
      engine.global.runSync()
    } catch (error) {
      // A failed script may have changed globals; never reuse that partial state.
      this.close()
      throw error
    } finally {
      if (this.engine) engine.global.setTop(stackTop)
    }
  }

  close(): void {
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
