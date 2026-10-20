import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'

// Private inputs, reference lookup and curves stay in memory or disposable copies.
// Only numeric IDs and aggregate classifications are emitted; no error text/paths.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const legacy = resolve(process.env.LEGACY_ROOT ?? resolve(root, 'old/reMagX3'))
const temporary = await mkdtemp(resolve(tmpdir(), 'remagx-private-comparison-'))
const destination = resolve(root, 'build/private-corpus-test')
const timeout = 120000
let browser, server
try {
  const diagnosticArguments = process.argv.slice(2)
  if (diagnosticArguments.length > 1 || diagnosticArguments.some(value => value !== '--energy')) throw new Error('Unsupported diagnostic arguments')
  const energyScan = diagnosticArguments[0] === '--energy'
  async function discover(directory) {
    const projects = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Unsupported private symbolic link')
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) projects.push(...await discover(path))
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.all')) projects.push(path)
    }
    return projects.sort()
  }
  const originals = await discover(legacy)
  if (!originals.length) throw new Error('Empty private corpus')
  const copied = resolve(temporary, 'corpus')
  await cp(legacy, copied, { recursive: true })
  const projects = await discover(copied)
  if (projects.length !== originals.length) throw new Error('Private copy count changed')
  const executable = resolve(temporary, 'reference')
  execFileSync('python3', [resolve(root, 'tools/golden/legacy/build_simulation_reference.py'), '--legacy-root', legacy, '--output', executable],
    { stdio: 'pipe', timeout: 180000 })
  const raw = await readFile(resolve(legacy, 'shared/LayerSegmentation.cpp'))
  if (createHash('sha256').update(raw).digest('hex') !== '5d7b1c3d0a5a784584f17fa49c92c1612569e362c2858d57b039da867e922e48') throw new Error('Reference lookup source drift')
  const text = raw.toString('latin1').replaceAll('\r\n', '\n')
  const start = text.indexOf('double gammln('), end = text.indexOf('/*\nvoid LayerSegmentation3', start)
  if (start < 0 || end <= start) throw new Error('Reference lookup extraction failed')
  const lookupSource = resolve(temporary, 'lookup.cpp'), lookupExecutable = resolve(temporary, 'lookup')
  await writeFile(lookupSource, '#include <cmath>\n#include <vector>\n#include <iostream>\n#include <iomanip>\nusing namespace std;\ntemplate<class T> using CVector=vector<T>;\nvoid nrerror(const char*) {}\n' +
    text.slice(start, end) + '\nint main(){erffinit();cout<<setprecision(17);for(double value:table)cout<<value<<" ";}\n')
  execFileSync('g++', ['-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', lookupSource, '-o', lookupExecutable], { stdio: 'pipe', timeout: 30000 })
  const samples = execFileSync(lookupExecutable, [], { stdio: 'pipe', timeout: 30000 }).toString().trim().split(/\s+/).map(Number)
  if (samples.length !== 1001 || !samples.every(Number.isFinite)) throw new Error('Invalid reference lookup')
  const inputs = []
  for (const [index, path] of projects.entries()) {
    const source = await readFile(path, 'latin1')
    const tables = []
    for (const entry of await readdir(dirname(path), { withFileTypes: true })) {
      if (entry.isFile() && /\.(db|m|ff|ffm|e|f)$/i.test(entry.name)) {
        tables.push({ name: entry.name, source: await readFile(resolve(dirname(path), entry.name), 'latin1') })
      }
    }
    let points, referenceError
    try {
      const output = execFileSync('python3', ['-c', 'import os,resource,sys;resource.setrlimit(resource.RLIMIT_CORE,(0,0));os.execv(sys.argv[1],sys.argv[1:])', executable, path, ...(energyScan ? ['--energy'] : [])],
        { cwd: dirname(path), stdio: 'pipe', timeout, maxBuffer: 64 * 1024 * 1024 }).toString()
      points = JSON.parse(output)
      if (!Array.isArray(points) || !points.length || !points.every(row => Array.isArray(row) && row.length === 2 && row.every(Number.isFinite))) throw new Error('Invalid reference curve')
    } catch (error) { referenceError = error.code === 'ETIMEDOUT' ? 'reference-timeout' : 'reference-error' }
    inputs.push({ id: index + 1, source, tables, points, referenceError, energyScan })
    if ((index + 1) % 10 === 0) console.log(JSON.stringify({ stage: 'reference', completed: index + 1, total: projects.length }))
  }
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
  await page.evaluate(samples => { window.privateReferenceService = window.realServiceHarness.createReferenceComputeService(samples) }, samples)
  const reports = []
  for (const input of inputs) {
    const report = await page.evaluate(async input => {
      const { importAllFile, parseOpticalTable, diagnosticCategory, withDiagnosticDeadline } = window.realServiceHarness
      const service = window.privateReferenceService
      try {
        const { project } = importAllFile(input.source)
        const segmented = project.calculation.roughnessModel === 'segmentation'
        const tables = input.tables.map(table => parseOpticalTable(table.source, table.name))
        const before = JSON.stringify(project)
        const actual = await withDiagnosticDeadline(service[input.energyScan ? 'calcEnergyScan' : 'calcReflectivity'](project, undefined, tables), () => service.stop())
        if (JSON.stringify(project) !== before) return { id: input.id, segmented, status: 'input-changed' }
        if (input.referenceError) return { id: input.id, segmented, status: input.referenceError, workerCompleted: true }
        const coordinates = input.energyScan ? actual.energy : actual.qz
        if (coordinates.length !== input.points.length || actual.reflectivity.length !== input.points.length) return { id: input.id, segmented, status: 'length-mismatch' }
        let mismatches = 0, maximumAbsolute = 0, maximumLog10 = 0
        for (let index = 0; index < input.points.length; ++index) {
          for (const [value, reference] of [[coordinates[index], input.points[index][0]], [actual.reflectivity[index], input.points[index][1]]]) {
            if (!Number.isFinite(value) || !Number.isFinite(reference)) return { id: input.id, segmented, status: 'nonfinite' }
            const difference = Math.abs(value - reference)
            if (difference > 1e-15 + 1e-10 * Math.abs(reference)) ++mismatches
            maximumAbsolute = Math.max(maximumAbsolute, difference)
            if (value > 0 && reference > 0) maximumLog10 = Math.max(maximumLog10, Math.abs(Math.log10(value) - Math.log10(reference)))
          }
        }
        return { id: input.id, segmented, status: mismatches ? 'numerical-mismatch' : 'matched', points: input.points.length, mismatches, maximumAbsolute, maximumLog10 }
      } catch (error) {
        const category = diagnosticCategory(String(error.message))
        return { id: input.id, status: 'worker-error', category, referenceError: input.referenceError }
      }
    }, input)
    reports.push(report)
    console.log(JSON.stringify({ stage: 'comparison', completed: reports.length, total: inputs.length, id: report.id, status: report.status, referenceStatus: input.referenceError ?? 'completed', ...(report.category ? { category: report.category } : {}) }))
  }
  await page.evaluate(() => window.privateReferenceService.dispose())
  const counts = reports.reduce((counts, report) => { const key = report.category ?? report.status; counts[key] = (counts[key] ?? 0) + 1; return counts }, {})
  const compared = reports.filter(report => report.points !== undefined)
  const referenceCounts = inputs.reduce((counts, input) => { const key = input.referenceError ?? 'completed'; counts[key] = (counts[key] ?? 0) + 1; return counts }, {})
  const referenceCompletedFailures = reports.filter((report, index) => !inputs[index].referenceError && report.status !== 'matched').reduce((counts, report) => { const key = report.category ?? report.status; counts[key] = (counts[key] ?? 0) + 1; return counts }, {})
  const summary = { scope: energyScan ? 'private-energy-explicit-original-lookup' : 'private-qz-explicit-original-lookup', projects: reports.length, counts, referenceCounts, referenceCompletedFailures,
    segmentedCompared: compared.filter(report => report.segmented).length,
    segmentedMatched: compared.filter(report => report.segmented && report.status === 'matched').length,
    comparedPoints: compared.reduce((sum, report) => sum + report.points, 0),
    mismatchedValues: compared.reduce((sum, report) => sum + report.mismatches, 0),
    maximumAbsolute: Math.max(0, ...compared.map(report => report.maximumAbsolute)),
    maximumLog10: Math.max(0, ...compared.map(report => report.maximumLog10)),
    acceptancePassed: reports.length > 0 && reports.every(report => report.status === 'matched') }
  console.log(JSON.stringify(summary))
  if (!summary.acceptancePassed) process.exitCode = 1
} catch {
  console.error('Private corpus comparison failed; diagnostics withheld.')
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
