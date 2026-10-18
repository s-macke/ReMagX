import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const destination = resolve(root, 'build/real-ui-test')
const wasm = resolve(process.argv[2] ?? resolve(root, 'build/wasm'))
// Test-only replacement at build time; the deployed factory and bundle stay mock.
let replaced = false
await build({ root: resolve(root, 'app'), configFile: resolve(root, 'app/vite.config.ts'),
  build: { outDir: destination, emptyOutDir: true }, plugins: [{ name: 'real-ui-test', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/state/useCalculation.ts')) {
        assert.ok(code.includes('sharedService ??= new WorkerComputeService()'))
        replaced = true
        return "import { createRealComputeService } from '../compute/realComputeService'\n" +
          code.replace('sharedService ??= new WorkerComputeService()', 'sharedService ??= createRealComputeService()')
      }
      if (id.endsWith('/src/main.tsx')) return code +
        "\nimport { createRealUiFixture } from '../test/real-ui/fixture'\nObject.assign(window, { createRealUiFixture })\n"
    },
  }] })
assert.ok(replaced)
await mkdir(resolve(destination, 'assets'), { recursive: true })
for (const name of ['remagx-core.mjs', 'remagx-core.wasm']) await copyFile(resolve(wasm, name), resolve(destination, 'assets', name))
for (const name of ['parratt.mjs', 'fit_error.mjs', 'optimizer.mjs']) await copyFile(resolve(root, 'engine/wasm', name), resolve(destination, 'assets', name))
const assets = new Map()
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await collect(path, `${prefix}/${entry.name}`)
    else assets.set(`${prefix}/${entry.name}`, await readFile(path))
  }
}
await collect(destination)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }
const server = createServer((request, response) => {
  const path = request.url === '/' ? '/index.html' : request.url
  const asset = assets.get(path)
  response.writeHead(asset ? 200 : 404, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' })
  response.end(asset ?? 'Not found')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
async function timedClick(page, locator, selector) {
  await locator.evaluate((element, selector) => {
    window.clickElapsed = new Promise(resolve => {
      element.addEventListener('click', () => {
        const started = performance.now()
        const observer = new MutationObserver(() => {
          if (document.querySelector(selector)) { observer.disconnect(); resolve(performance.now() - started) }
        })
        observer.observe(document.body, { attributes: true, subtree: true, childList: true, characterData: true })
      }, { capture: true, once: true })
    })
  }, selector)
  await locator.click()
  return page.evaluate(() => window.clickElapsed)
}
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(30000)
  const failures = []
  page.on('pageerror', error => failures.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
    localStorage.setItem('remagx.expandedSections', JSON.stringify({ 'fit-start-stop': true, 'fit-debug': true }))
    window.requests = []; window.workerBlocked = false; window.resultCount = 0
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        this.addEventListener('message', event => {
          if (window.holdScriptResults && event.data.type === 'result' && event.data.result?.scriptMessages && !event.data.released) {
            event.stopImmediatePropagation()
            window.releaseScriptResult = () => this.dispatchEvent(new MessageEvent('message', { data: { ...event.data, released: true } }))
            return
          }
          if (event.data.browserTestBlocked) window.workerBlocked = true
          if (event.data.type === 'result') window.resultCount++
        })
      }
      postMessage(message) {
        window.requests.push(message.kind)
        super.postMessage({ ...message, browserTestBlock: message.kind === window.blockedKind })
      }
    }
  })
  await page.route('**/assets/realWorker-*.js', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: `${await response.text()}
      const original = self.onmessage;
      self.onmessage = event => {
        if (event.data.browserTestBlock) { self.postMessage({browserTestBlocked:true}); while(true) {} }
        return original(event);
      };` })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.waitForFunction(() => !!window.createRealUiFixture)
  const project = await page.evaluate(() => window.createRealUiFixture())
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'native-timing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Fit', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  await page.evaluate(() => {
    window.requests = []; window.iterations = [0]
    new MutationObserver(() => {
      const value = Number(document.querySelector('.fit-status dd')?.textContent)
      if (Number.isFinite(value) && value > window.iterations.at(-1)) window.iterations.push(value)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForFunction(() => window.iterations.length >= 3)
  await page.getByText('fitted R', { exact: true }).waitFor()
  const tabMilliseconds = await timedClick(page, page.getByRole('tab', { name: 'Experiment', exact: true }), '#tab-experiment[aria-selected="true"]')
  assert.ok(tabMilliseconds < 200, `Real-fit tab response: ${tabMilliseconds} ms`)
  await page.getByRole('tab', { name: 'Fit', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled(), true)
  const requests = await page.evaluate(() => window.requests)
  const fitRequest = requests.indexOf('fit')
  assert.ok(fitRequest >= 0)
  assert.deepEqual(requests.slice(fitRequest), ['fit'], 'No redraw requests may queue behind the real fit')
  const stopMilliseconds = await timedClick(page, page.locator('.mode-panel__stop'), '.mode-panel__stop:disabled')
  assert.ok(stopMilliseconds < 1000, `Real-fit Stop: ${stopMilliseconds} ms`)
  const blockedStops = []
  for (const kind of ['fit', 'reflectivity', 'chi2']) {
    await page.evaluate(kind => { window.blockedKind = kind; window.workerBlocked = false }, kind)
    await page.getByRole('button', { name: kind === 'fit' ? 'Start' : kind === 'chi2' ? 'χ²' : 'Reflectivity', exact: true }).click()
    await page.waitForFunction(() => window.workerBlocked)
    const elapsed = await timedClick(page, page.locator('.mode-panel__stop'), '.mode-panel__stop:disabled')
    assert.ok(elapsed < 1000, `${kind} blocked Stop: ${elapsed} ms`)
    blockedStops.push({ kind, milliseconds: elapsed })
    const previous = await page.evaluate(() => { window.blockedKind = undefined; return window.resultCount })
    await page.getByRole('button', { name: 'Reflectivity', exact: true }).click()
    await page.waitForFunction(previous => window.resultCount > previous, previous)
    await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  }
  // Actual Lua messages reach the visible Debug Window through normal UI requests.
  const scripted = structuredClone(project)
  scripted.sample.layers = [scripted.sample.layers[0], scripted.sample.layers[1], scripted.sample.layers.at(-1)]
  scripted.experiment.qzScan.points = 4
  scripted.datasets[0].columns.qz = scripted.datasets[0].columns.qz.slice(0, 4)
  scripted.datasets[0].columns.reflectivity = scripted.datasets[0].columns.reflectivity.slice(0, 4)
  scripted.fit.parameters = [scripted.fit.parameters[0]]
  scripted.fit.parameters[0].lowerBound = 30; scripted.fit.parameters[0].upperBound = 30
  scripted.scripts.enabled = true
  scripted.scripts.beforeCalculation = 'calls = (calls or 0) + 1; print("lua-ui:", calls, ":", renewocs)'
  async function openProject(value) {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
    await (await chooser).setFiles({ name: 'script-output.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
  }
  await openProject(scripted)
  await page.waitForFunction(() => document.querySelector('.debug-log')?.textContent.includes('lua-ui:1:0'))
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  for (const mode of ['Dichroic', 'Asymmetry']) {
    const count = await page.locator('.debug-log').evaluate(node => node.textContent.split('lua-ui:1:0').length)
    await page.getByRole('radio', { name: mode, exact: true }).check()
    await page.waitForFunction(count => document.querySelector('.debug-log')?.textContent.split('lua-ui:1:0').length > count, count)
  }
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.debug-log')?.textContent.includes('lua-ui:2:1'))
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  assert.ok((await page.locator('.debug-log').textContent()).includes('lua-ui:3:0'))
  // Hold a completed result, stop the request, then deliver its obsolete callback.
  await page.evaluate(() => { window.holdScriptResults = true; window.releaseScriptResult = undefined })
  scripted.scripts.beforeCalculation = 'print("obsolete-lua-output")'
  await openProject(scripted)
  await page.waitForFunction(() => !!window.releaseScriptResult)
  await page.locator('.mode-panel__stop').click()
  await page.evaluate(() => { window.holdScriptResults = false; window.releaseScriptResult() })
  await page.waitForTimeout(200)
  assert.ok(!(await page.locator('.debug-log').textContent()).includes('obsolete-lua-output'))
  assert.deepEqual(failures, [])
  console.log(JSON.stringify({ realUi: 'passed', points: 10000, layers: 102, tabMilliseconds, stopMilliseconds, blockedStops }))
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
