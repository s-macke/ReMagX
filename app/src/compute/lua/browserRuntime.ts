import wasmLocation from 'wasmoon/dist/glue.wasm?url'
import { createLuaRuntime } from './runtime'

/** Lazy, worker-owned runtime with a Vite-emitted, same-origin WASM asset. */
export function createBrowserLuaRuntime() {
  return createLuaRuntime(wasmLocation)
}
