import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'

// Public synthetic cases only; original sources and compiler diagnostics stay private.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const destination = resolve(root, 'build/spectrum-reference-test')
const temporary = await mkdtemp(resolve(tmpdir(), 'remagx-spectrum-reference-'))
let server, browser
try {
  const executable = resolve(temporary, 'reference')
  execFileSync('python3', [resolve(root, 'tools/golden/legacy/build_simulation_reference.py'), '--spectrum',
    '--legacy-root', resolve(process.env.LEGACY_ROOT ?? resolve(root, 'old/reMagX3')), '--output', executable],
  { stdio: 'pipe', timeout: 180000 })
  const fixture = await readFile(resolve(root, 'app/test/fixtures/default.all'), 'utf8')
  const tables = []
  async function addTable(name, kind, energy, columns) {
    tables.push({ name, kind, energy, columns, warnings: [] })
    await writeFile(resolve(temporary, `${name}.${kind}`), energy.map((value, index) =>
      [value, ...columns.map(column => column[index])].join(' ')).join('\n') + '\n')
  }
  for (const [index, name] of ['Cu', 'Co', 'vacuum'].entries()) {
    const scale = name === 'vacuum' ? 0 : index + 1
    await addTable(name, 'db', [710, 780, 890], [[.001, .002, .003].map(value => value * scale), [.0001, .0002, .0004].map(value => value * scale)])
    await addTable(name, 'm', [700, 760, 900], [[.00001, .00003, .00002].map(value => value * scale), [.000002, .000001, .000003].map(value => value * scale)])
  }
  await addTable('Fe', 'ff', [700, 760, 850], [[20, 24, 26], [1, 3, 2]])
  await addTable('Ni', 'ff', [720, 800, 880], [[26, 28, 29], [2, 1, 3]])
  const elements = '\nelementlayerversion = 1\n' + ['Fe', 'Ni'].map((name, index) =>
    `element = ${name}\nel_f1 = 10\nel_f2 = 2\nel_f1m = 0\nel_f2m = 0\n` +
    [0, 1, 2].map(layer => `el_layer = ${layer}\nel_d = ${layer === 1 ? 20 : 0}\nel_density = ${layer === 2 ? 0 : .1 / (1 + index + layer)}\nel_sigma = 0\n`).join('')).join('')
  const cases = []
  for (const mode of ['compound', 'element']) for (const algorithm of [0, 1, 2]) for (const automatic of [0, 1]) {
    const scripts = mode === 'compound'
      ? ['', 'calls = (calls or 0) + 1; delta[1] = delta[1] + calls * 0.00001; deltam[1] = deltam[1] + calls * 0.000001', 'delta[1] = delta[1] + energy * 0.00000001; energy = energy + 7']
      : ['', 'calls = (calls or 0) + 1; f1[0] = f1[0] + calls; Ni:setdensity(1, Ni:getdensity(1) + 0.001)', 'f1[0] = f1[0] + energy / 1000; energy = energy + 7']
    const selections = mode === 'compound' ? [['optical', 0, 0], ['optical', 1, 0], ['magnetic', 0, 0], ['magnetic', 1, 0]]
      : [['factors', 0, 0], ['factors', 0, 1], ['optical', 0, 0], ['optical', 1, 1], ['optical', 2, 0]]
    for (const [scriptIndex, script] of scripts.entries()) for (const [kind, layerIndex, elementIndex] of selections) {
      const source = fixture + `\nmode = ${mode === 'element' ? 1 : 0}\nalgorithm = ${algorithm}\nocautomatic = ${automatic}\nusechantlerdatabase = 0\nenergy = 777\ndisablescript = ${script ? 0 : 1}\n` +
        (mode === 'element' ? elements : '') + (script ? `scriptline = ${script}\n` : '')
      const path = resolve(temporary, 'project.all')
      await writeFile(path, source)
      let points
      try { points = JSON.parse(execFileSync(executable, [path, kind, String(layerIndex), String(elementIndex)],
        { cwd: temporary, stdio: 'pipe', timeout: 30000 }).toString()) }
      catch { throw new Error(`Spectrum case ${cases.length}: native preparation failed`) }
      if (!points.length || points.some(row => row.length !== 3 || !row.every(Number.isFinite)))
        throw new Error(`Spectrum case ${cases.length}: invalid native output`)
      cases.push({ source, points, mode, algorithm, automatic, scriptIndex, kind, layerIndex, elementIndex })
    }
  }
  await build({ configFile: false, root: resolve(root, 'app'), base: './', worker: { format: 'es' },
    build: { outDir: destination, emptyOutDir: true,
      rollupOptions: { input: resolve(root, 'app/test/real-service/entry.ts'), output: { entryFileNames: 'entry.js' } } } })
  await mkdir(resolve(destination, 'assets'), { recursive: true })
  for (const file of ['parratt.mjs', 'fit_error.mjs', 'optimizer.mjs', 'segmentation.mjs'])
    await copyFile(resolve(root, 'engine/wasm', file), resolve(destination, 'assets', file))
  const wasm = resolve(process.env.WASM_DIRECTORY ?? resolve(root, 'build/wasm'))
  for (const file of ['remagx-core.mjs', 'remagx-core.wasm']) await copyFile(resolve(wasm, file), resolve(destination, 'assets', file))
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
  const result = await page.evaluate(async ({ cases, tables }) => {
    const { importAllFile, createRealComputeService } = window.realServiceHarness
    const service = createRealComputeService()
    const reports = []
    let values = 0, mismatches = 0
    try {
      for (const { source, points, ...settings } of cases) {
        const { project } = importAllFile(source)
        const snapshot = JSON.stringify(project)
        const actual = settings.kind === 'factors' ? await service.scatteringFactors(project, { elementIndex: settings.elementIndex, tables })
          : await service.layerSpectrum(project, { layerIndex: settings.layerIndex, elementIndex: settings.elementIndex, magnetic: settings.kind === 'magnetic', tables })
        const columns = [actual.energy, actual.first, actual.second]
        if (columns.some(column => column.length !== points.length)) throw new Error('Spectrum case: wrong curve shape')
        let caseMismatches = 0, firstMismatch = null
        for (let row = 0; row < points.length; ++row) for (let column = 0; column < 3; ++column) {
          const value = columns[column][row], expected = points[row][column]
          if (!Number.isFinite(value) || Math.abs(value - expected) > 1e-15 + 1e-10 * Math.abs(expected)) {
            caseMismatches++; mismatches++
            firstMismatch ??= { row, column, value, expected }
          }
          values++
        }
        if (JSON.stringify(project) !== snapshot) throw new Error('Spectrum case: input mutated')
        reports.push({ ...settings, mismatches: caseMismatches, firstMismatch })
      }
      return { acceptancePassed: cases.length === 162 && mismatches === 0, cases: cases.length, values, mismatches, reports }
    } finally { service.dispose() }
  }, { cases, tables })
  const provenance = {}
  for (const [name, path] of Object.entries({
    diagnostic: fileURLToPath(import.meta.url),
    publicFixture: resolve(root, 'app/test/fixtures/default.all'),
    adapter: resolve(root, 'tools/golden/legacy/spectrum_reference.cpp'),
    buildHelper: resolve(root, 'tools/golden/legacy/build_simulation_reference.py'),
    sourceManifest: resolve(root, 'tools/golden/legacy/simulation_sources.json'),
    nativeExecutable: executable, wasm: resolve(wasm, 'remagx-core.wasm'),
  })) provenance[name] = createHash('sha256').update(await readFile(path)).digest('hex')
  console.log(JSON.stringify({ ...result, provenance }, null, 2))
  if (!result.acceptancePassed && process.argv.includes('--require-parity')) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('Spectrum case') ? error.message : 'Spectrum reference comparison failed; private diagnostics withheld.')
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
