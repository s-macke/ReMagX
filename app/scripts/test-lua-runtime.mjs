import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build, preview } from 'vite'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../test/lua-browser', import.meta.url))
const outDir = fileURLToPath(new URL('../../build/lua-browser', import.meta.url))
await build({ root, configFile: false, base: './', build: { outDir, emptyOutDir: true } })
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
  assert.match(result.diagnostic, /BeforeCalculation:3:/)
  assert.deepEqual(errors, [])
  assert.ok(requests.some(url => url.endsWith('.wasm')), 'Worker must load the local WASM asset')
  assert.ok(requests.every(url => new URL(url).origin === origin), 'No external runtime requests')
  console.log('Lua worker: local WASM, synchronous execution, line diagnostics and session isolation passed')
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
