import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createDefaultProject } from '../src/model/defaults'
import { generateSnippet } from '../src/model/scriptSnippets'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))

it.each(['deltaBetaRatio', 'magneticRatio'] as const)('executes %s with the exact computed double coefficient', async kind => {
  const session = await runtime.createSession()
  try {
    // Unit input isolates literal parsing from any later multiplication rounding.
    for (const [numerator, denominator] of [[1, 3], [1e-12, 1], [1.2345678901234567, 1],
      [Number.MIN_VALUE, 1], [Number.MAX_VALUE, 1], [-0, 1], [-1, 3], [0, 1]]) {
      const project = createDefaultProject()
      project.sample.layers[0].delta = project.sample.layers[0].deltaMag = denominator
      project.sample.layers[0].beta = project.sample.layers[0].betaMag = numerator
      const line = generateSnippet(kind, project)[0]
      session.execute(`delta = {[0] = 1.0}; deltam = {[0] = 1.0}; beta = {}; betam = {}\n${line}\nresult = ${kind === 'deltaBetaRatio' ? 'beta' : 'betam'}[0]`, 'Default')
      expect(session.getGlobal('result')).toBe(numerator / denominator)
    }
  } finally { session.close() }
})
