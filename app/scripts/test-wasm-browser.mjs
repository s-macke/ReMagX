import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const modulePath = resolve(process.argv[2])
const input = JSON.parse(readFileSync(0, 'utf8'))
const cases = [...input.angular, ...input.qz.map(prepared => ({ ...prepared, kind: 'qz' }))]
const assets = new Map([
  ['/element_optics_checks.mjs', ['text/javascript', readFileSync(resolve(root, 'engine/tests/element_optics_checks.mjs'))]],
  ['/scattering_checks.mjs', ['text/javascript', readFileSync(resolve(root, 'engine/tests/scattering_checks.mjs'))]],
  ['/remagx-core.mjs', ['text/javascript', readFileSync(modulePath)]],
  ['/remagx-core.wasm', ['application/wasm', readFileSync(modulePath.replace(/\.mjs$/, '.wasm'))]],
  ['/fit_error.mjs', ['text/javascript', readFileSync(resolve(root, 'engine/wasm/fit_error.mjs'))]],
  ['/fit_error_checks.mjs', ['text/javascript', readFileSync(resolve(root, 'engine/tests/fit_error_checks.mjs'))]],
  ['/optimizer.mjs', ['text/javascript', readFileSync(resolve(root, 'engine/wasm/optimizer.mjs'))]],
  ['/optimizer_checks.mjs', ['text/javascript', readFileSync(resolve(root, 'engine/tests/optimizer_checks.mjs'))]],
  ['/parratt.mjs', ['text/javascript', readFileSync(resolve(root, 'engine/wasm/parratt.mjs'))]],
  ['/worker.mjs', ['text/javascript', readFileSync(resolve(root, 'engine/tests/browser_worker.mjs'))]],
  ['/', ['text/html', '<!doctype html><title>WASM worker verification</title>']],
])
// Serve only these test assets; never expose the repository or private corpus.
const server = createServer((request, response) => {
  const asset = assets.get(request.url)
  response.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.[0] ?? 'text/plain' })
  response.end(asset?.[1] ?? 'Not found')
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  const result = await page.evaluate(async ({ elementOptics, scattering, lineShapes, cases, tables, energy, scans, tensors, matrices, zak, profiles, optimizer, fitErrors }) => {
    const next = (worker, kind) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error(`Worker timeout: ${kind}`)) }, 10000)
      const cleanup = () => {
        clearTimeout(timeout)
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
      }
      const onError = event => { cleanup(); reject(new Error(event.message)) }
      const onMessage = event => {
        if (event.data.kind === 'failure') { cleanup(); reject(new Error(event.data.message)) }
        else if (event.data.kind === kind) { cleanup(); resolve(event.data) }
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
    })
    let worker = new Worker('/worker.mjs', { type: 'module' })
    try {
      await next(worker, 'ready')
      const response = next(worker, 'results')
      worker.postMessage({ elementOptics, scattering, lineShapes, cases, tables, energy, scans, tensors, matrices, zak, profiles, optimizer, fitErrors })
      const { elementOptics: elementOpticsCount, scattering: scatteringCount, lineShapes: lineShapeResults, values, tables: tableResults, energy: energyResults, scans: scanResults, tensors: tensorResults, matrices: matrixResults, zak: zakResults, profiles: profileResults, optimizer: optimizerResults, fitErrors: fitErrorValues } = await response
      const entered = next(worker, 'entered')
      let finished = false
      worker.addEventListener('message', event => { if (event.data.kind === 'finished') finished = true })
      worker.postMessage({ kind: 'busy' })
      await entered
      // A browser event-loop turn while the WASM calculation occupies its worker.
      const tickStart = performance.now()
      await new Promise(resolve => setTimeout(resolve, 0))
      const tickMilliseconds = performance.now() - tickStart
      const start = performance.now()
      worker.terminate()
      worker = new Worker('/worker.mjs', { type: 'module' })
      await next(worker, 'ready')
      const replacementResponse = next(worker, 'results')
      worker.postMessage({ cases: [cases[0]] })
      const replacement = (await replacementResponse).values[0]
      return { elementOpticsCount, scatteringCount, lineShapeResults, fitErrorValues, optimizerResults, profileResults, zakResults, matrixResults, tensorResults, scanResults, energyResults, values, tableResults, replacement, finished, tickMilliseconds, recoveryMilliseconds: performance.now() - start }
    } finally {
      worker.terminate()
    }
  }, { elementOptics: input.elementOptics, scattering: input.scattering, lineShapes: input.lineShapes, cases, tables: input.tables, energy: input.energy, scans: input.scans, tensors: input.tensors, matrices: input.matrices, zak: input.zak, profiles: input.profiles, optimizer: input.optimizer, fitErrors: input.fitErrors })
  assert.equal(result.elementOpticsCount, 5200)
  console.log('Chromium element optics: 5,200 values, validation, growth and cleanup passed.')
  assert.equal(result.scatteringCount, 8640)
  console.log('Chromium scattering tensors: 8,640 components, validation, growth and cleanup passed.')
  assert.equal(result.fitErrorValues, 12480)
  console.log(`Chromium dataset fit errors: ${result.fitErrorValues} native means/residuals, validation, growth and cleanup passed.`)
  assert.deepEqual(result.optimizerResults, { cases: input.optimizer.length, validation: true, stop: true, growth: true, cleanup: true, reflectivity: true })
  console.log(`Chromium optimizer: ${result.optimizerResults.cases} native comparisons, callbacks, Stop, memory growth and cleanup passed.`)
  let count = 0, maxLogError = 0
  for (const [caseIndex, prepared] of cases.entries()) {
    assert.equal(result.values[caseIndex].length, prepared.expected.length)
    result.values[caseIndex].forEach((value, index) => {
      const target = prepared.expected[index]
      assert.ok(Number.isFinite(value))
      assert.ok(Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target), `case ${caseIndex}, point ${index}`)
      if (value > 0 && target > 0) {
        const relative = (value - target) / target
        maxLogError = Math.max(maxLogError, Math.abs(relative) < .5
          ? Math.abs(Math.log1p(relative) / Math.LN10) : Math.abs(Math.log10(value) - Math.log10(target)))
      }
      count++
    })
  }
  assert.equal(count, 14880)
  let matrixCount = 0
  input.matrices.forEach((item, index) => {
    assert.equal(result.matrixResults[index].length, item.expected.length)
    result.matrixResults[index].forEach((value, beam) => {
      const target = item.expected[beam]
      assert.ok(Number.isFinite(value) && Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target),
        `Visnovsky case ${index}, beam ${beam}: ${value} vs ${target}`)
      matrixCount++
    })
  })
  assert.equal(matrixCount, 18144)
  console.log(`Chromium Visnovsky: ${matrixCount} intensities matched native.`)
  let zakCount = 0
  input.zak.forEach((item, index) => {
    assert.equal(result.zakResults[index].length, item.expected.length)
    result.zakResults[index].forEach((value, beam) => {
      const target = item.expected[beam]
      assert.ok(Number.isFinite(value) && Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target),
        `Zak case ${index}, beam ${beam}: ${value} vs ${target}`)
      zakCount++
    })
  })
  assert.equal(zakCount, 15552)
  console.log(`Chromium Zak: ${zakCount} intensities matched native.`)
  assert.equal(result.lineShapeResults.length, 1218)
  input.lineShapes.forEach((item, index) => assert.ok(Math.abs(result.lineShapeResults[index] - item.expected) <= 1e-15 + 1e-10 * Math.abs(item.expected)))
  console.log('Chromium Gauss-Lorentzian helpers: 630 imaginary and 588 real values matched native.')
  let profileCount = 0
  input.profiles.forEach((item, index) => {
    assert.equal(result.profileResults[index].length, item.expected.length)
    result.profileResults[index].forEach((value, beam) => {
      const target = item.expected[beam]
      assert.ok(Number.isFinite(value) && Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target),
        `Gaussian profiles/knots/application case ${index}, value ${beam}: ${value} vs ${target}`)
      profileCount++
    })
  })
  assert.equal(profileCount, 13080)
  console.log(`Chromium Gaussian profiles/knots/application: ${profileCount} values matched native.`)
  let tensorCount = 0
  input.tensors.forEach((item, index) => {
    assert.equal(result.tensorResults[index].anisotropic, item.anisotropic)
    assert.equal(result.tensorResults[index].values.length, 18)
    result.tensorResults[index].values.forEach((value, component) => {
      assert.ok(Math.abs(value - item.expected[component]) <= 1e-15 + 1e-10 * Math.abs(item.expected[component]))
      tensorCount++
    })
  })
  assert.equal(tensorCount, 8640)
  console.log(`Chromium dielectric tensors: ${tensorCount} components and ${input.tensors.length} classifications matched native.`)
  let scanCount = 0
  input.scans.forEach((item, index) => result.scanResults[index].forEach((value, point) => {
    assert.ok(Math.abs(value - item.expected[point]) <= 1e-15 + 1e-10 * Math.abs(item.expected[point]))
    scanCount++
  }))
  assert.equal(scanCount, 1584)
  console.log(`Chromium prepared energy scans: ${scanCount} intensities matched native.`)
  let energyCount = 0
  input.energy.forEach((item, index) => result.energyResults[index].forEach((value, point) => {
    assert.ok(Math.abs(value - item.expected[point]) <= 1e-15 + 1e-10 * Math.abs(item.expected[point]))
    energyCount++
  }))
  assert.equal(energyCount, 3360)
  console.log(`Chromium energy/fast-qz convolution: ${energyCount} values matched native.`)
  let tableCount = 0
  assert.equal(result.tableResults.length, input.tables.length)
  input.tables.forEach((table, index) => {
    const actual = result.tableResults[index]
    assert.equal(actual.cursor, table.expectedCursor)
    assert.equal(actual.values.length, table.expected.length)
    actual.values.forEach((value, column) => {
      assert.ok(Math.abs(value - table.expected[column]) <= 1e-15 + 1e-10 * Math.abs(table.expected[column]))
      tableCount++
    })
  })
  assert.equal(tableCount, 14760)
  console.log(`Chromium table lookup: ${tableCount} values and ${input.tables.length} cursor sequences matched native.`)
  assert.equal(result.finished, false, 'busy calculation must still be running at termination')
  assert.ok(result.tickMilliseconds < 200, `browser event loop took ${result.tickMilliseconds} ms`)
  assert.ok(result.recoveryMilliseconds < 1000, `replacement took ${result.recoveryMilliseconds} ms`)
  assert.deepEqual(result.replacement, result.values[0])
  console.log(`Chromium worker: ${count} comparisons; max log10 error ${maxLogError} decades; event loop ${result.tickMilliseconds.toFixed(1)} ms; terminate/recreate/calculate ${result.recoveryMilliseconds.toFixed(1)} ms`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
