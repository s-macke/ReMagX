import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

// Keep Emscripten's loader and binary adjacent to the bundled compute worker.
// A missing core is a build error; there is no mock or network fallback.
export function wasmAssets(): Plugin {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const core = resolve(process.env.WASM_DIRECTORY ?? resolve(root, 'build/wasm'))
  const paths = new Map([
    ...['remagx-core.mjs', 'remagx-core.wasm'].map(name => [name, resolve(core, name)] as const),
    ...['parratt.mjs', 'fit_error.mjs', 'optimizer.mjs', 'segmentation.mjs'].map(name => [name, resolve(root, 'engine/wasm', name)] as const),
  ])
  const read = (name: string) => {
    try { return readFileSync(paths.get(name)!) }
    catch { throw new Error(`Missing real-engine asset ${name}. Build the WASM core first or set WASM_DIRECTORY to its build directory.`) }
  }
  let prepared: Map<string, Buffer>
  return {
    name: 'remagx-wasm-assets',
    config(_config, environment) {
      // Pure unit tests do not build or run the production worker.
      if (environment.mode === 'test') return
      prepared = new Map(Array.from(paths.keys(), name => [name, read(name)]))
      const hash = createHash('sha256')
      for (const [name, source] of prepared) hash.update(name).update(source)
      return { define: { 'import.meta.env.REMAGX_CORE_VERSION': JSON.stringify(hash.digest('hex')) } }
    },
    generateBundle() {
      for (const name of paths.keys()) this.emitFile({ type: 'asset', fileName: `assets/${name}`, source: prepared.get(name)! })
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0]
        const name = pathname?.startsWith('/src/compute/') ? pathname.slice('/src/compute/'.length) : ''
        if (!paths.has(name)) return next()
        try {
          response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
          response.end(prepared.get(name))
        } catch (error) {
          response.statusCode = 503
          response.end(error instanceof Error ? error.message : 'Real engine unavailable')
        }
      })
    },
  }
}
