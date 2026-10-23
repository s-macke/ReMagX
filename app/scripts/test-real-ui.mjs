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
async function expectMissingOpticalTable(page, trigger) {
  const count = await page.evaluate(() => window.tableRequests.length)
  await trigger()
  // Opening a project debounces its redraw. Wait for this action's error reply,
  // not the preceding project's still-visible footer or detail button.
  await page.waitForFunction(count => window.tableRequests.slice(count).some(request =>
    window.tableReplies[request.id] === 'error'), count)
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  // The footer shows the actionable summary; the dialog retains the full
  // table diagnostic. Exercise the same detail/close path available to users.
  await page.getByRole('button', { name: 'Error details', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Calculation error', exact: true })
  await dialog.waitFor()
  assert.match(await page.locator('.status-bar__error').textContent(), /Optical database lookup failed/)
  assert.match(await dialog.locator('.calculation-error__detail').textContent(), /missing optical table/)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
}
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(30000)
  const failures = []
  page.on('pageerror', error => failures.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })
    localStorage.setItem('remagx.expandedSections', JSON.stringify({ 'fit-start-stop': true, 'fit-debug': true }))
    window.tableRequests = []; window.tableReplies = {}; window.requests = []; window.workerBlocked = false; window.resultCount = 0
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        this.addEventListener('message', event => {
          if (event.data.type === 'result' || event.data.type === 'error') window.tableReplies[event.data.id] = event.data.type;
          if (window.holdScriptResults && event.data.type === 'scriptMessages' && !event.data.released) {
            event.stopImmediatePropagation()
            ;(window.heldScriptMessages ??= []).push(() => this.dispatchEvent(new MessageEvent('message', { data: { ...event.data, released: true } })))
            return
          }
          if (window.holdScriptResults && event.data.type === 'result' && event.data.result?.scriptMessages && !event.data.released) {
            event.stopImmediatePropagation()
            window.releaseScriptResult = () => { for (const release of window.heldScriptMessages ?? []) release(); window.heldScriptMessages = []; this.dispatchEvent(new MessageEvent('message', { data: { ...event.data, released: true } })) }
            return
          }
          if (event.data.browserTestBlocked) window.workerBlocked = true
          if (event.data.type === 'result') window.resultCount++
        })
      }
      postMessage(message) {
        delete window.tableReplies[message.id]
        window.requests.push(message.kind)
        window.tableRequests.push({ id: message.id, kind: message.kind, tables: structuredClone(message.tables) })
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
  const beforeRepeat = await page.locator('.debug-log').evaluate(node => node.textContent.split('lua-ui:1:0').length)
  await page.getByRole('button', { name: 'Reflectivity', exact: true }).click()
  await page.waitForFunction(count => document.querySelector('.debug-log')?.textContent.split('lua-ui:1:0').length > count, beforeRepeat)
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  assert.equal(await page.locator('.debug-log').evaluate(node => node.textContent.split('lua-ui:1:0').length), beforeRepeat + 1)
  for (const mode of ['Dichroic', 'Asymmetry']) {
    const count = await page.locator('.debug-log').evaluate(node => node.textContent.split('lua-ui:1:0').length)
    await page.getByRole('radio', { name: mode, exact: true }).check()
    await page.waitForFunction(count => document.querySelector('.debug-log')?.textContent.split('lua-ui:1:0').length > count, count)
  }
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.debug-log')?.textContent.includes('lua-ui:2:1'))
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  assert.ok((await page.locator('.debug-log').textContent()).includes('lua-ui:3:0'))
  const previousMessages = await page.locator('.debug-log').evaluate(node => node.textContent.split('lua-ui:1:0').length)
  await page.getByRole('button', { name: 'χ²', exact: true }).click()
  await page.waitForFunction(count => document.querySelector('.debug-log')?.textContent.split('lua-ui:1:0').length > count, previousMessages)
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  // Hold a completed result, stop the request, then deliver its obsolete callback.
  await page.evaluate(() => { window.holdScriptResults = true; window.releaseScriptResult = undefined })
  scripted.scripts.beforeCalculation = 'print("obsolete-lua-output")'
  await openProject(scripted)
  await page.waitForFunction(() => !!window.releaseScriptResult)
  await page.locator('.mode-panel__stop').click()
  await page.evaluate(() => { window.holdScriptResults = false; window.releaseScriptResult() })
  await page.waitForTimeout(200)
  assert.ok(!(await page.locator('.debug-log').textContent()).includes('obsolete-lua-output'))
  // Output preceding a Lua error is visible once, even though no curve/fit
  // result carries the successful-result fallback transcript.
  scripted.scripts.beforeCalculation = 'print("before-script-error"); error("script failure")'
  await openProject(scripted)
  await page.waitForFunction(() => document.querySelector('.debug-log')?.textContent.includes('before-script-error'))
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  const beforeFitError = await page.locator('.debug-log').evaluate(node => node.textContent.split('before-script-error').length)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.debug-log')?.textContent.includes('Fit error:'))
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  assert.equal(await page.locator('.debug-log').evaluate(node => node.textContent.split('before-script-error').length), beforeFitError + 1)
  // The energy button requires primary tables even in manual mode. Its strict
  // gate runs before Lua; the qz redraw can still execute the same script.
  scripted.experiment.qzScan.useDatasetPoints = true
  scripted.datasets[0].columns.energy = [640, 641, 642, 643]
  scripted.scripts.beforeCalculation = 'print("energy-ui:", renewocs)'
  await openProject(scripted)
  await page.waitForFunction(() => document.querySelector('.debug-log')?.textContent.includes('energy-ui:0'))
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  for (const mode of ['Monochromatic', 'Dichroic', 'Asymmetry']) {
    await page.getByRole('radio', { name: mode, exact: true }).check()
    await page.waitForTimeout(200)
    const count = await page.locator('.debug-log').evaluate(node => node.textContent.split('energy-ui:0').length)
    await expectMissingOpticalTable(page, () => page.getByRole('button', { name: 'Energy Scan', exact: true }).click())
    await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
    assert.equal(await page.locator('.debug-log').evaluate(node => node.textContent.split('energy-ui:0').length), count)
  }
  // Explicit Script Window execution, atomic publication and JSON/undo preservation.
  const manual = structuredClone(scripted)
  manual.scripts.enabled = false
  manual.calculation.automaticOpticalConstants = false
  manual.scripts.default = 'print("manual-default"); thickness[1] = 42; exx_r[1] = 7'
  manual.scripts.beforeCalculation = 'print("manual-before"); thickness[1] = 43; exx_r[1] = 8'
  await openProject(manual)
  await page.getByRole('button', { name: 'Open script window', exact: true }).click()
  const scriptWindow = page.getByRole('dialog', { name: 'Script Window', exact: true })
  async function saveProject() {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
    return JSON.parse(await readFile(await (await download).path(), 'utf8'))
  }
  for (const [program, thickness, tensor] of [['Default', 42, 7], ['BeforeCalculation', 43, 8]]) {
    await scriptWindow.getByRole('tab', { name: program, exact: true }).click()
    const count = await scriptWindow.locator('pre').evaluate(node => node.textContent.split('Script finished.').length)
    await scriptWindow.getByRole('button', { name: 'Execute', exact: true }).click()
    await page.waitForFunction(count => document.querySelector('.script-window__output')?.textContent.split('Script finished.').length > count, count)
    const saved = await saveProject()
    assert.equal(saved.sample.layers[1].thickness, thickness)
    assert.equal(saved.sample.layers[1].dielectricTensor.values[0], tensor)
    assert.equal(saved.scripts.enabled, false)
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
    const undone = await saveProject()
    assert.equal(undone.sample.layers[1].thickness, program === 'Default' ? manual.sample.layers[1].thickness : 42)
    await page.getByRole('button', { name: 'Redo (Ctrl+Y)', exact: true }).click()
    assert.deepEqual(await saveProject(), saved)
  }
  const savedManual = await saveProject()
  await openProject(savedManual)
  assert.deepEqual(await saveProject(), savedManual)
  manual.scripts.default = 'thickness[1] = 99\nprint("manual failure output")\nerror("failure")'
  await openProject(manual)
  await scriptWindow.getByRole('tab', { name: 'Default', exact: true }).click()
  await scriptWindow.getByRole('button', { name: 'Execute', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.script-window__output')?.textContent.includes('Default:3'))
  assert.ok((await scriptWindow.locator('pre').textContent()).includes('manual failure output'))
  assert.deepEqual(await saveProject(), manual)
  manual.scripts.default = 'print("manual loop entered"); while true do end'
  await openProject(manual)
  await scriptWindow.getByRole('button', { name: 'Execute', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.script-window__output')?.textContent.includes('manual loop entered'))
  const manualStopMilliseconds = await timedClick(page, scriptWindow.getByRole('button', { name: 'Stop', exact: true }), '.script-window__bar button:last-child:disabled')
  assert.ok(manualStopMilliseconds < 1000)
  assert.deepEqual(await saveProject(), manual)
  // A held result cannot overwrite a newly loaded project or release old output.
  manual.scripts.default = 'print("obsolete-manual"); thickness[1] = 999'
  await openProject(manual)
  await page.evaluate(() => { window.holdScriptResults = true; window.releaseScriptResult = undefined })
  await scriptWindow.getByRole('button', { name: 'Execute', exact: true }).click()
  await page.waitForFunction(() => !!window.releaseScriptResult)
  manual.scripts.default = 'print("fresh-manual"); thickness[1] = 44'
  await openProject(manual)
  // setFiles resolves before the async JSON reader commits the loaded project.
  await page.waitForFunction(() => document.querySelector('.script-window .cm-content')?.textContent.includes('fresh-manual'))
  await page.waitForFunction(() => document.querySelector('.script-window__bar button:last-child')?.disabled)
  await page.evaluate(() => { window.holdScriptResults = false; window.releaseScriptResult() })
  assert.deepEqual(await saveProject(), manual)
  assert.ok(!(await scriptWindow.locator('pre').textContent()).includes('obsolete-manual'))
  await scriptWindow.getByRole('button', { name: 'Execute', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.script-window__output')?.textContent.includes('fresh-manual'))
  await page.waitForFunction(() => document.querySelector('.script-window__bar button:last-child')?.disabled)
  assert.equal((await saveProject()).sample.layers[1].thickness, 44)
  manual.scripts.default = 'print("close-loop-entered"); while true do end'
  await openProject(manual)
  await scriptWindow.getByRole('button', { name: 'Execute', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.script-window__output')?.textContent.includes('close-loop-entered'))
  await scriptWindow.getByRole('button', { name: 'Close script window', exact: true }).click()
  manual.scripts.default = 'print("reopened-script"); thickness[1] = 45'
  await openProject(manual)
  await page.getByRole('button', { name: 'Open script window', exact: true }).click()
  await scriptWindow.getByRole('tab', { name: 'Default', exact: true }).click()
  await scriptWindow.getByRole('button', { name: 'Execute', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.script-window__output')?.textContent.includes('Script finished.'))
  assert.equal((await saveProject()).sample.layers[1].thickness, 45)
  await scriptWindow.getByRole('button', { name: 'Close script window', exact: true }).click()
  // Exercise actual library uploads through all UI calculation entry points.
  const libraryProject = structuredClone(scripted)
  libraryProject.calculation.automaticOpticalConstants = true
  libraryProject.experiment.energy = 640
  libraryProject.datasets[0].energy = 640
  libraryProject.fit.errorFunction = 'lin-chi2'
  libraryProject.sample.layers.forEach((layer, index) => { layer.opticalTable = `ui-${index}` })
  libraryProject.scripts.beforeCalculation = 'assert(delta[1] > 0); print("library:", delta[1])'
  await expectMissingOpticalTable(page, () => openProject(libraryProject))
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  await page.getByRole('button', { name: 'Optical Constants Database', exact: true }).click()
  async function loadLibrary(delta) {
    const files = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Load tables…', exact: true }).click()
    await (await files).setFiles([.02, delta, 0].map((value, index) => ({ name: `ui-${index}.db`, mimeType: 'text/plain',
      buffer: Buffer.from(`600 ${value} 0.0001\n800 ${value} 0.0001`) })))
    await page.waitForFunction(value => window.tableRequests.some(request => request.tables?.find(table => table.name === 'ui-1')?.columns[0][0] === value), delta)
    await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  }
  await loadLibrary(.01)
  async function checkRequest(kind, click, expectedDelta) {
    const count = await page.evaluate(() => window.tableRequests.length)
    await click()
    await page.waitForFunction(({ count, kind }) => window.tableRequests.slice(count).some(request => request.kind === kind), { count, kind })
    const request = await page.evaluate(({ count, kind }) => window.tableRequests.slice(count).find(request => request.kind === kind), { count, kind })
    assert.equal(request.tables.find(table => table.name === 'ui-1').columns[0][0], expectedDelta)
    await page.waitForFunction(id => window.tableReplies[id], request.id)
    assert.equal(await page.evaluate(id => window.tableReplies[id], request.id), 'result')
    await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  }
  for (const [mode, qzKind, energyKind] of [['Monochromatic', 'reflectivity', 'energyScan'], ['Dichroic', 'asymmetry', 'energyAsymmetry']]) {
    await page.getByRole('radio', { name: mode, exact: true }).check()
    await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
    await checkRequest(qzKind, () => page.getByRole('button', { name: 'Reflectivity', exact: true }).click(), .01)
    await checkRequest(energyKind, () => page.getByRole('button', { name: 'Energy Scan', exact: true }).click(), .01)
  }
  await loadLibrary(.015)
  await page.getByRole('tab', { name: 'Fit', exact: true }).click()
  await checkRequest('chi2', () => page.getByRole('button', { name: 'χ²', exact: true }).click(), .015)
  await checkRequest('fit', () => page.getByRole('button', { name: 'Start', exact: true }).click(), .015)
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  await expectMissingOpticalTable(page, () => page.getByRole('button', { name: 'Delete optical constants cache', exact: true }).click())
  const cleared = await page.evaluate(() => window.tableRequests.at(-1))
  assert.deepEqual(cleared.tables, [])
  // Exercise real failure paths through project loading, worker preparation/native
  // calculation, footer guidance and the full-detail dialog. No error reply is injected.
  const valid = structuredClone(project)
  valid.sample.layers = [valid.sample.layers[0], valid.sample.layers[1], valid.sample.layers.at(-1)]
  valid.experiment.qzScan = { ...valid.experiment.qzScan, points: 4, useDatasetPoints: false }
  valid.datasets = []; valid.activeDatasetIndex = null; valid.fit.parameters = []
  valid.scripts.enabled = false; valid.calculation.automaticOpticalConstants = false
  // The preceding library checks leave the energy view selected. Select qz
  // explicitly so its native boundary, rather than strict energy-table loading,
  // is the operation under test.
  await expectMissingOpticalTable(page, () => openProject(valid))
  await page.getByRole('radio', { name: 'Monochromatic', exact: true }).check()
  const readyResults = await page.evaluate(() => window.resultCount)
  await page.getByRole('button', { name: 'Reflectivity', exact: true }).click()
  await page.waitForFunction(count => window.resultCount > count, readyResults)
  await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
  const qzFailure = structuredClone(valid)
  qzFailure.experiment.qzScan.qzMin = 10; qzFailure.experiment.qzScan.qzMax = 11
  const multilayerFailure = structuredClone(valid)
  multilayerFailure.sample.multilayer = { enabled: true, pattern: '0, 2*(1, 2' }
  const compilationFailure = structuredClone(valid)
  compilationFailure.scripts.enabled = true
  compilationFailure.scripts.beforeCalculation = 'local value = 1\nif then'
  const executionFailure = structuredClone(valid)
  executionFailure.scripts.enabled = true
  executionFailure.scripts.beforeCalculation = 'thickness[1] = 99\nerror("real-ui-source-line")'
  for (const [input, summary, detail] of [
    [qzFailure, /Qz exceeds the legacy calculation boundary/, /incident angle cannot exceed 90 degrees/],
    [multilayerFailure, /Multilayer expansion failed/, /closing parenthesis/],
    [compilationFailure, /Lua script compilation failed/, /BeforeCalculation.*:2:/s],
    [executionFailure, /Lua script execution failed/, /BeforeCalculation.*:2:.*real-ui-source-line/s],
  ]) {
    const count = await page.evaluate(() => window.tableRequests.length)
    await openProject(input)
    await page.waitForFunction(count => window.tableRequests.slice(count).some(request =>
      window.tableReplies[request.id] === 'error'), count)
    await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
    assert.match(await page.locator('.status-bar__error').textContent(), summary)
    await page.getByRole('button', { name: 'Error details', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Calculation error', exact: true })
    await dialog.waitFor()
    assert.match(await dialog.locator('.calculation-error__detail').textContent(), detail)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).isDisabled())
    const saved = await saveProject()
    for (const key of ['sample', 'experiment', 'scripts', 'calculation', 'datasets', 'fit'])
      assert.deepEqual(saved[key], input[key], `Real calculation failure changed ${key}`)
    const results = await page.evaluate(() => window.resultCount)
    await openProject(valid)
    await page.waitForFunction(count => window.resultCount > count, results)
    await page.waitForFunction(() => document.querySelector('.mode-panel__stop')?.disabled)
    assert.equal(await page.locator('.status-bar__error').count(), 0)
  }
  console.log('Real UI errors: native qz, multilayer, Lua compilation/execution guidance, full source diagnostics, unchanged saved project/undo and recovery passed.')
  assert.deepEqual(failures, [])
  console.log(JSON.stringify({ realUi: 'passed', points: 10000, layers: 102, tabMilliseconds, stopMilliseconds, blockedStops, manualStopMilliseconds }))
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
