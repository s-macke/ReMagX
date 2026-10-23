import { createServer } from 'node:http'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { loadFitInputs, sha256, summarizeFitComparisons } from './fit-reference-inputs.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temporary = await mkdtemp(resolve(tmpdir(), 'remagx-private-fit-'))
const destination = temporary

let browser, server
try {
  for (const name of ['CORPUS_DIR', 'FIT_REFERENCE_BUNDLE', 'FIT_LOOKUP_FILE']) {
    if (!process.env[name]?.trim()) throw new Error('Missing private fit configuration')
  }
  const bundleBytes = await readFile(process.env.FIT_REFERENCE_BUNDLE)
  const lookupBytes = await readFile(process.env.FIT_LOOKUP_FILE)
  const samples = JSON.parse(lookupBytes)
  if (!Array.isArray(samples) || samples.length !== 1001 || !samples.every(Number.isFinite)) throw new Error('Invalid reference lookup')
  const inputs = await loadFitInputs(process.env.CORPUS_DIR, JSON.parse(bundleBytes), process.env.FIT_CASES)
  const deadline = Number(process.env.FIT_DEADLINE_MS ?? 120000)
  if (!Number.isSafeInteger(deadline) || deadline <= 0) throw new Error('Invalid diagnostic deadline')
  await build({ configFile: false, root: resolve(root, 'app'), base: './', worker: { format: 'es' }, logLevel: 'silent',
    build: { outDir: destination, emptyOutDir: true,
      rollupOptions: { input: resolve(root, 'app/test/real-service/entry.ts'), output: { entryFileNames: 'entry.js' } } } })
  await mkdir(resolve(destination, 'assets'), { recursive: true })
  for (const file of ['parratt.mjs', 'segmentation.mjs', 'fit_error.mjs', 'optimizer.mjs']) await copyFile(resolve(root, 'engine/wasm', file), resolve(destination, 'assets', file))
  const wasm = resolve(process.env.WASM_DIRECTORY ?? resolve(root, 'build/wasm'))
  for (const file of ['remagx-core.mjs', 'remagx-core.wasm']) await copyFile(resolve(wasm, file), resolve(destination, 'assets', file))
  const assets = new Map([['/', ['text/html', '<!doctype html><script type="module" src="./entry.js"></script>']]])
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await collect(path, `${prefix}/${entry.name}`)
      else assets.set(`${prefix}/${basename(path)}`, [extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript', await readFile(path)])
    }
  }
  await collect(destination)
  server = createServer((request, response) => {
    const asset = assets.get(request.url)
    response.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.[0] ?? 'text/plain' }); response.end(asset?.[1] ?? 'Not found')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.waitForFunction(() => !!window.realServiceHarness)
  await page.evaluate(samples => { window.privateReferenceSamples = samples }, samples)

  const reports = []
  for (const input of inputs) {
    const report = await page.evaluate(async ({ input, deadline }) => {
      const { importAllFile, parseOpticalTable, diagnosticCategory, withDiagnosticDeadline } = window.realServiceHarness
      const service = window.realServiceHarness.createReferenceComputeService(window.privateReferenceSamples)
      let lastProgress
      try {
        const { project } = importAllFile(input.source)
        if ((project.fit.evolution.randomSeed >>> 0) !== input.reference.seed ||
            project.fit.algorithm !== (input.reference.algorithm === 0 ? 'simplex' : 'simplex-annealing'))
          return { id: input.id, status: 'reference-settings-mismatch' }
        const tables = input.tables.map(table => parseOpticalTable(table.source, table.name))
        const before = JSON.stringify(project)
        const result = await withDiagnosticDeadline(service.startFit(project, progress => {
          lastProgress = { iteration: progress.iteration,
            reachedTarget: progress.chi2 <= input.reference.error * (1 + 1e-6) }
        }, undefined, tables), () => service.stop(), deadline)
        if (JSON.stringify(project) !== before) return { id: input.id, status: 'input-changed' }
        const passed = Number.isFinite(result.chi2) && result.chi2 <= input.reference.error * (1 + 1e-6)
        return { id: input.id, status: passed ? 'matched' : 'fit-quality-failed', chi2: result.chi2,
          reference: input.reference.error, values: result.values, iterations: result.iterations,
          inputHash: input.inputHash, lastProgress }
      } catch (error) {
        return { id: input.id, status: 'worker-error', category: diagnosticCategory(String(error.message)), privateMessage: String(error.message), lastProgress }
      } finally { service.dispose() }
    }, { input, deadline })
    reports.push(report)
    // Private numbers and diagnostics remain in memory; public logs contain IDs/status only.
    console.log(JSON.stringify({ id: report.id, status: report.status, category: report.category, lastIteration: report.lastProgress?.iteration, reachedTarget: report.lastProgress?.reachedTarget }))
  }
  const summary = summarizeFitComparisons(inputs, reports)
  console.log(JSON.stringify({ ...summary, referenceSha256: sha256(bundleBytes), lookupSha256: sha256(lookupBytes),
    wasmSha256: sha256(assets.get('/assets/remagx-core.wasm')[1]),
    assetsSha256: sha256(JSON.stringify([...assets].sort(([a], [b]) => a.localeCompare(b)).map(([name, [, content]]) => [name, sha256(content)]))) }))
  if (!summary.passed) process.exitCode = 1

} catch {
  console.error('Private fit comparison failed; details withheld.')
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
