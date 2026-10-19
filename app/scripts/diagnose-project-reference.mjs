import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'

// A completed diagnostic is not a parity pass: acceptancePassed reports D-23.
// --require-parity additionally makes numerical mismatches fail the process.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const destination = resolve(root, 'build/project-reference-test')
const temporary = await mkdtemp(resolve(tmpdir(), 'remagx-project-reference-'))
let server, browser
try {
  const executable = resolve(temporary, 'reference')
  execFileSync('python3', [resolve(root, 'tools/golden/legacy/build_simulation_reference.py'),
    '--legacy-root', resolve(process.env.LEGACY_ROOT ?? resolve(root, 'old/reMagX3')),
    '--output', executable], { stdio: 'pipe', timeout: 180000 })
  const fixture = await readFile(resolve(root, 'app/test/fixtures/default.all'), 'utf8')
  const cases = []
  const tables = []
  for (const [name, minimum, maximum, delta, beta] of [
    ['Cu', 710, 890, .0016, .0002], ['Co', 720, 880, .003, .001], ['vacuum', 700, 900, 0, 0],
  ]) {
    const magnetic = name === 'Co' ? .0001 : 0
    for (const [kind, columns] of [
      ['db', [[delta * .9, delta * 1.1], [beta * .9, beta * 1.1]]],
      ['m', [[magnetic, magnetic * 2], [magnetic / 2, magnetic]]],
    ]) {
      const energy = [minimum, maximum]
      await writeFile(resolve(temporary, `${name}.${kind}`), energy.map((value, index) =>
        [value, ...columns.map(column => column[index])].join(' ')).join('\n') + '\n')
      tables.push({ name, kind, energy, columns, warnings: [] })
    }
  }
  async function addCase(source, settings) {
    const path = resolve(temporary, 'project.all')
    await writeFile(path, source)
    const points = JSON.parse(execFileSync(executable, [path, ...(settings.asymmetry ? ['--asymmetry'] : []), ...(settings.scan === 'energy' ? ['--energy'] : []), ...(settings.fixedAngle ? ['--angle'] : [])], { cwd: temporary, stdio: 'pipe', timeout: 30000 }).toString())
    cases.push({ source, points, settings })
  }
  for (const algorithm of [0, 1, 2]) for (const magnetic of [0, 1])
    for (const resolution of [0, .001]) for (const fast of [0, 1]) {
    const source = fixture.replace(/^(algorithm\s*=).*$/m, `$1 ${algorithm}`)
      .replace(/^(magnetizationmode\s*=).*$/m, `$1 ${magnetic}`)
      .replace(/^(resolution\s*=).*$/m, `$1 ${resolution}`)
      .replace(/^(fastresolution\s*=).*$/m, `$1 ${fast}`)
    await addCase(source, { algorithm, magnetic, resolution, fast, scan: 'generated' })
  }
  for (const algorithm of [0, 1, 2]) for (const fast of [0, 1])
    for (const shift of [0, 1e-10, 1.1e-10, .007, -.007]) {
      const source = fixture.replace(/^(algorithm\s*=).*$/m, `$1 ${algorithm}`)
        .replace(/^(magnetizationmode\s*=).*$/m, '$1 1')
        .replace(/^(fastresolution\s*=).*$/m, `$1 ${fast}`)
        .replace(/^(usemeasurementqz\s*=).*$/m, '$1 1') + '\n' + [
          'datasetnumber = 1', 'dataset_qz = 0.4', 'dataset_R0 = 99',
          'datasetnumber = 2', `datasetqztranslation = ${shift}`,
          'datasetmultiplicator = 9', 'datasettranslator = 2',
          'datasetresolution = 0.05', 'datasetenergyshift = 7',
          'datasetray1sigmare = 0', 'datasetray1pire = 1',
          ...[.1, .03, .1, .07].flatMap(value => [`dataset_qz = ${value}`, 'dataset_R0 = -7']),
          'activedatasetindex = 2', '',
        ].join('\n')
      await addCase(source, { algorithm, magnetic: 1, fast, shift, scan: 'dataset' })
    }
  for (const algorithm of [0, 1, 2]) for (const definition of [0, 1])
    for (const resolution of [0, .001]) for (const fast of [0, 1]) {
      const source = fixture + `\nalgorithm = ${algorithm}\nmagnetizationmode = 1\nasymmetrydef = ${definition}\nresolution = ${resolution}\nfastresolution = ${fast}\n`
      await addCase(source, { algorithm, definition, resolution, fast, asymmetry: true, scan: 'generated' })
    }
  for (const algorithm of [0, 1, 2]) for (const definition of [null, 0, 1])
    for (const fixedAngle of [false, true]) for (const energyWidth of [0, 2]) {
      const source = fixture + `\nalgorithm = ${algorithm}\nmagnetizationmode = 1\nasymmetrydef = ${definition ?? 0}\nnumberofpoints = 8\nengscanmin = 700\nengscanmax = 900\nenergyresolution = ${energyWidth}\n`
      await addCase(source, { algorithm, definition, fixedAngle, energyWidth, asymmetry: definition !== null, scan: 'energy' })
    }
  for (const algorithm of [0, 1, 2]) for (const definition of [null, 0, 1]) {
    const source = fixture + `\nalgorithm = ${algorithm}\nmagnetizationmode = 1\nasymmetrydef = ${definition ?? 0}\nenergyresolution = 2\nusemeasurementqz = 1\ndatasetnumber = 1\ndatasetqztranslation = 0.007\ndatasetenergyshift = 2\n` +
      [[.1, 800], [.08, 760], [.1, 800]].map(([qz, energy]) => `dataset_qz = ${qz}\ndataset_eng = ${energy}\n`).join('') +
      'activedatasetindex = 1\n'
    await addCase(source, { algorithm, definition, energyWidth: 2, asymmetry: definition !== null, scan: 'energy', dataset: true })
  }
  await build({ configFile: false, root: resolve(root, 'app'), base: './', worker: { format: 'es' },
    build: { outDir: destination, emptyOutDir: true,
      rollupOptions: { input: resolve(root, 'app/test/real-service/entry.ts'), output: { entryFileNames: 'entry.js' } } } })
  await mkdir(resolve(destination, 'assets'), { recursive: true })
  for (const file of ['fit_error.mjs', 'optimizer.mjs', 'parratt.mjs'])
    await copyFile(resolve(root, 'engine/wasm', file), resolve(destination, 'assets', file))
  const wasm = resolve(process.env.WASM_DIRECTORY ?? resolve(root, 'build/wasm'))
  for (const file of ['remagx-core.mjs', 'remagx-core.wasm'])
    await copyFile(resolve(wasm, file), resolve(destination, 'assets', file))
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
    let values = 0, maxLog10Error = 0, mismatches = 0, zeroPairs = 0, nonpositiveMismatches = 0
    const reports = []
    try {
      for (let index = 0; index < cases.length; ++index) {
        const { source, points, settings } = cases[index]
        let caseMismatches = 0, firstMismatch = null, firstMismatchDetail = null, maxAbsoluteError = 0
        const columnNames = settings.asymmetry ? [settings.scan === 'energy' ? 'energy' : 'qz', 'plus', 'minus', 'asymmetry'] : [settings.scan === 'energy' ? 'energy' : 'qz', 'reflectivity']
        const mismatchesByColumn = Object.fromEntries(columnNames.map(name => [name, 0]))
        const { project } = importAllFile(source)
        if (settings.fixedAngle) project.experiment.energyScan.fixed = 'angle'
        const snapshot = JSON.stringify(project)
        const actual = settings.scan === 'energy'
          ? settings.asymmetry ? await service.calcEnergyAsymmetry(project, undefined, tables) : await service.calcEnergyScan(project, undefined, tables)
          : settings.asymmetry ? await service.calcAsymmetry(project) : await service.calcReflectivity(project)
        const coordinates = settings.scan === 'energy' ? actual.energy : actual.qz
        const columns = settings.asymmetry
          ? [actual.reflectivityPlus, actual.reflectivityMinus, actual.asymmetry] : [actual.reflectivity]
        if (coordinates.length !== points.length || columns.some(column => column.length !== points.length))
          throw new Error(`Project ${index}: curve length mismatch`)
        for (let row = 0; row < points.length; ++row) {
          for (const [columnIndex, column] of [coordinates, ...columns].entries()) {
            const value = column[row], reference = points[row][columnIndex]
            if (!Number.isFinite(value) || !Number.isFinite(reference)) throw new Error(`Project ${index}: nonfinite result`)
            maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(value - reference))
            if (Math.abs(value - reference) > 1e-15 + 1e-10 * Math.abs(reference)) {
              caseMismatches++; mismatches++; firstMismatch ??= row
              mismatchesByColumn[columnNames[columnIndex]]++
              firstMismatchDetail ??= { row, column: columnNames[columnIndex], value, reference }
            }
            values++
          }
          const primary = columns[0]
          if (primary[row] === 0 && points[row][1] === 0) zeroPairs++
          else if (primary[row] <= 0 || points[row][1] <= 0) nonpositiveMismatches++
          if (primary[row] > 0 && points[row][1] > 0)
            maxLog10Error = Math.max(maxLog10Error, Math.abs(Math.log10(primary[row]) - Math.log10(points[row][1])))
        }
        reports.push({ ...settings, mismatches: caseMismatches, mismatchesByColumn, firstMismatch, firstMismatchDetail, maxAbsoluteError })
        if (JSON.stringify(project) !== snapshot) throw new Error(`Project ${index}: input mutated`)
      }
      return { acceptancePassed: mismatches === 0, projects: cases.length, values, mismatches, maxLog10Error, zeroPairs, nonpositiveMismatches, reports }
    } finally { service.dispose() }
  }, { cases, tables })
  console.log(JSON.stringify(result, null, 2))
  if (!result.acceptancePassed && process.argv.includes('--require-parity')) process.exitCode = 1
} catch (error) {
  // Only public generated fixtures are used; never echo compiler/source diagnostics.
  console.error(error instanceof Error && error.message.includes('Project ') ? error.message : 'Native project reference comparison failed; diagnostics withheld.')
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
