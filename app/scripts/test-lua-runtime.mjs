import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build, preview } from 'vite'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../test/lua-browser', import.meta.url))
const outDir = fileURLToPath(new URL('../../build/lua-browser', import.meta.url))
await build({ root, configFile: false, base: './', build: { outDir, emptyOutDir: true } })
await mkdir(resolve(outDir, 'assets'), { recursive: true })
const coreDirectory = fileURLToPath(new URL('../../build/wasm/', import.meta.url))
for (const name of ['remagx-core.mjs', 'remagx-core.wasm']) await copyFile(resolve(coreDirectory, name), resolve(outDir, 'assets', name))
await copyFile(fileURLToPath(new URL('../../engine/wasm/parratt.mjs', import.meta.url)), resolve(outDir, 'assets/parratt.mjs'))
const server = await preview({ root, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage()
  const origin = new URL(server.resolvedUrls.local[0]).origin
  const requests = []
  const errors = []
  page.on('request', request => requests.push(request.url()))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  const result = await page.evaluate(() => window.luaResult)
  assert.equal(result.error, undefined)
  assert.equal(result.energy, 700.375)
  assert.equal(result.version, 'Lua 5.4')
  assert.equal(result.isolated, true)
  assert.equal(result.arraysPassed, true)
  assert.equal(result.solutionPassed, true)
  assert.equal(result.tensorPassed, true)
  assert.equal(result.elementsPassed, true)
  assert.equal(result.factorsPassed, true)
  assert.equal(result.functionsPassed, true)
  assert.equal(result.opticsPassed, true)
  assert.match(result.diagnostic, /BeforeCalculation:3:.*KramersKronigRange: not supported yet/)
  assert.deepEqual(errors, [])
  assert.ok(requests.some(url => url.endsWith('.wasm')), 'Worker must load the local WASM asset')
  assert.ok(requests.every(url => new URL(url).origin === origin), 'No external runtime requests')
  console.log('Lua worker: local WASM, synchronous execution, scalar/result/tensor arrays and element userdata, line diagnostics and session isolation passed')
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
