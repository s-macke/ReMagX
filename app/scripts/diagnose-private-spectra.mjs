import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'

// All project selections are attempted. Only IDs, hashes and value-free diagnostics
// leave the disposable private copy; no filenames, curves or script text are logged.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const legacy = resolve(process.env.LEGACY_ROOT ?? resolve(root, 'old/reMagX3'))
const destination = resolve(root, 'build/private-spectrum-test')
const temporary = await mkdtemp(resolve(tmpdir(), 'remagx-private-spectra-'))
const timeout = 120000
let browser, server
async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Unsupported symbolic link')
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex')
async function treeDigest(directory) {
  const hash = createHash('sha256')
  for (const path of await files(directory)) hash.update(JSON.stringify([relative(directory, path), await digest(path)]))
  return hash.digest('hex')
}
try {
  if (process.argv.length !== 2) throw new Error('No subset arguments are supported')
  const originalFiles = await files(legacy)
  const projects = originalFiles.filter(path => /\.all$/i.test(path)).map(path => relative(legacy, path))
  if (!projects.length) throw new Error('Empty corpus')
  const inputHash = await treeDigest(legacy)
  const copied = resolve(temporary, 'corpus')
  await cp(legacy, copied, { recursive: true })
  if (await treeDigest(copied) !== inputHash) throw new Error('Copy changed inputs')
  const executable = resolve(temporary, 'reference')
  execFileSync('python3', [resolve(root, 'tools/golden/legacy/build_simulation_reference.py'), '--spectrum',
    '--legacy-root', legacy, '--output', executable], { stdio: 'pipe', timeout: 180000 })
  await build({ configFile: false, root: resolve(root, 'app'), base: './', worker: { format: 'es' }, logLevel: 'silent',
    build: { outDir: destination, emptyOutDir: true,
      rollupOptions: { input: resolve(root, 'app/test/real-service/entry.ts'), output: { entryFileNames: 'entry.js' } } } })
  await mkdir(resolve(destination, 'assets'), { recursive: true })
  for (const name of ['parratt.mjs', 'fit_error.mjs', 'optimizer.mjs', 'segmentation.mjs'])
    await copyFile(resolve(root, 'engine/wasm', name), resolve(destination, 'assets', name))
  const wasm = resolve(process.env.WASM_DIRECTORY ?? resolve(root, 'build/wasm'))
  for (const name of ['remagx-core.mjs', 'remagx-core.wasm']) await copyFile(resolve(wasm, name), resolve(destination, 'assets', name))
  const assets = new Map([['/', ['text/html', '<!doctype html><script type="module" src="./entry.js"></script>']]])
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await collect(path, `${prefix}/${entry.name}`)
      else assets.set(`${prefix}/${entry.name}`, [extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript', await readFile(path)])
    }
  }
  await collect(destination)
  server = createServer((request, response) => {
    const asset = assets.get(request.url)
    response.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.[0] ?? 'text/plain' })
    response.end(asset?.[1] ?? 'Not found')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.waitForFunction(() => !!window.realServiceHarness)
  await page.evaluate(() => { window.spectrumService = window.realServiceHarness.createRealComputeService() })
  const reports = [], projectReports = []
  for (const [index, name] of projects.entries()) {
    const path = resolve(copied, name)
    const source = await readFile(path, 'latin1')
    const tables = []
    for (const entry of await readdir(dirname(path), { withFileTypes: true })) {
      if (entry.isFile() && /\.(db|m|ff|ffm|e|f)$/i.test(entry.name))
        tables.push({ name: entry.name, source: await readFile(resolve(dirname(path), entry.name), 'latin1') })
    }
    const prepared = await page.evaluate(({ source, tables }) => {
      const { importAllFile, parseOpticalTable, diagnosticCategory } = window.realServiceHarness
      try {
        const { project } = importAllFile(source)
        const queries = project.sample.mode === 'compound'
          ? project.sample.layers.flatMap((_, layerIndex) => ['optical', 'magnetic'].map(kind => ({ kind, layerIndex, elementIndex: 0 })))
          : project.sample.elementProfiles.flatMap((element, elementIndex) => [{ kind: 'factors', layerIndex: 0, elementIndex },
            ...element.slabs.map((_, layerIndex) => ({ kind: 'optical', layerIndex, elementIndex }))])
        window.spectrumInput = { project, snapshot: JSON.stringify(project), tables: tables.map(table => parseOpticalTable(table.source, table.name)) }
        return { queries }
      } catch (error) { return { error: diagnosticCategory(error instanceof Error ? error.message : '') } }
    }, { source, tables })
    if (!prepared.queries?.length) {
      projectReports.push({ id: index + 1, status: prepared.error ? 'preparation-error' : 'no-selections', category: prepared.error })
      console.log(JSON.stringify({ stage: 'project', id: index + 1, total: projects.length, status: projectReports.at(-1).status }))
      continue
    }
    const offset = reports.length
    for (const [queryIndex, query] of prepared.queries.entries()) {
      let points, referenceStatus = 'completed'
      try {
        const output = execFileSync('python3', ['-c', 'import os,resource,sys;resource.setrlimit(resource.RLIMIT_CORE,(0,0));os.execv(sys.argv[1],sys.argv[1:])',
          executable, path, query.kind, String(query.layerIndex), String(query.elementIndex)],
        { cwd: dirname(path), stdio: 'pipe', timeout, maxBuffer: 64 * 1024 * 1024 }).toString()
        points = JSON.parse(output)
        if (!Array.isArray(points) || !points.length || points.some(row => !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite)))
          throw new Error('Invalid reference')
      } catch (error) {
        referenceStatus = error.code === 'ETIMEDOUT' ? 'reference-timeout' : error.status === 6 ? 'reference-missing-grid'
          : error.status === 7 ? 'reference-script' : error.status === 8 ? 'reference-invalid-output' : 'reference-error'
      }
      const result = await page.evaluate(async ({ query, points, referenceStatus }) => {
        const { project, snapshot, tables } = window.spectrumInput
        const { withDiagnosticDeadline, diagnosticCategory, compareDiagnosticColumns } = window.realServiceHarness
        const service = window.spectrumService
        try {
          const request = query.kind === 'factors' ? service.scatteringFactors(project, { elementIndex: query.elementIndex, tables })
            : service.layerSpectrum(project, { elementIndex: query.elementIndex, layerIndex: query.layerIndex, magnetic: query.kind === 'magnetic', tables })
          const actual = await withDiagnosticDeadline(request, () => service.stop())
          if (JSON.stringify(project) !== snapshot) return { status: 'input-changed' }
          if (actual.engine !== 'real') return { status: 'wrong-engine' }
          if (referenceStatus !== 'completed') return { status: 'reference-unavailable', workerCompleted: true }
          return compareDiagnosticColumns([{ name: 'energy', values: actual.energy },
            { name: 'first', values: actual.first }, { name: 'second', values: actual.second }], points)
        } catch (error) {
          if (JSON.stringify(project) !== snapshot) return { status: 'input-changed' }
          return { status: 'worker-error', category: diagnosticCategory(error instanceof Error ? error.message : '') }
        }
      }, { query, points, referenceStatus })
      reports.push({ id: index + 1, selection: queryIndex + 1, ...query, referenceStatus, ...result })
      if ((queryIndex + 1) % 25 === 0) console.log(JSON.stringify({ stage: 'selection', id: index + 1, completed: queryIndex + 1, total: prepared.queries.length }))
    }
    const current = reports.slice(offset)
    projectReports.push({ id: index + 1, selections: current.length, status: current.every(row => row.status === 'matched') ? 'matched' : 'incomplete' })
    console.log(JSON.stringify({ stage: 'project', id: index + 1, total: projects.length, selections: current.length,
      matched: current.filter(row => row.status === 'matched').length }))
  }
  await page.evaluate(() => window.spectrumService.dispose())
  const inputsUnchanged = await treeDigest(copied) === inputHash && await treeDigest(legacy) === inputHash
  const counts = key => reports.reduce((result, row) => { const value = key(row); result[value] = (result[value] ?? 0) + 1; return result }, {})
  const summary = { scope: 'private-all-layer-element-spectra', projects: projects.length, selections: reports.length,
    counts: counts(row => row.category ?? row.status), referenceCounts: counts(row => row.referenceStatus),
    comparedValues: reports.reduce((sum, row) => sum + (row.comparedValues ?? 0), 0),
    mismatches: reports.reduce((sum, row) => sum + (row.mismatches ?? 0), 0), inputsUnchanged,
    acceptancePassed: inputsUnchanged && projects.length === 99 && projectReports.every(row => row.status === 'matched'),
    provenance: { inputTree: inputHash, adapter: await digest(resolve(root, 'tools/golden/legacy/spectrum_reference.cpp')),
      manifest: await digest(resolve(root, 'tools/golden/legacy/simulation_sources.json')), executable: await digest(executable),
      wasm: await digest(resolve(wasm, 'remagx-core.wasm')), diagnostic: await digest(fileURLToPath(import.meta.url)) },
    projectReports, reports }
  console.log(JSON.stringify(summary))
  if (!summary.acceptancePassed) process.exitCode = 1
} catch {
  console.error('Private spectrum diagnostic failed; details withheld.')
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
