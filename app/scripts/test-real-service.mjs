import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const destination = resolve(root, 'build/real-service-test')
const wasmDirectory = resolve(process.argv[2] ?? resolve(root, 'build/wasm'))
await build({ configFile: false, root: resolve(root, 'app'), base: './', worker: { format: 'es' },
  build: { outDir: destination, emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'app/test/real-service/entry.ts'), output: { entryFileNames: 'entry.js' } } } })
await mkdir(resolve(destination, 'assets'), { recursive: true })
for (const file of ['remagx-core.mjs', 'remagx-core.wasm']) await copyFile(resolve(wasmDirectory, file), resolve(destination, 'assets', file))
const adapter = await readFile(resolve(root, 'engine/wasm/parratt.mjs'), 'utf8')
const entryCall = '    const status = resolution'
assert.ok(adapter.includes(entryCall))
// Test-only marker immediately before the actual synchronous C API call.
await writeFile(resolve(destination, 'assets/parratt.mjs'), adapter.replace(entryCall,
  '    if (qz.length >= 100000) self.postMessage({ realCoreEntered: true })\n' + entryCall))
const assets = new Map([['/', ['text/html', '<!doctype html><script type="module" src="./entry.js"></script>']]])
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await collect(path, `${prefix}/${entry.name}`)
    else assets.set(`${prefix}/${entry.name}`, [extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript', await readFile(path)])
  }
}
await collect(destination)
const server = createServer((request, response) => {
  const asset = assets.get(request.url)
  response.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.[0] ?? 'text/plain' })
  response.end(asset?.[1] ?? 'Not found')
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.waitForFunction(() => !!window.realServiceHarness)
  const results = await page.evaluate(async () => {
    const { prepareFitDataset, importAllFile, precisionFixture, createDefaultProject, createLayer, createRealComputeService } = window.realServiceHarness
    let enteredResolve
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        this.addEventListener('message', event => { if (event.data.realCoreEntered) enteredResolve?.() })
      }
    }
    let tables = []
    const service = createRealComputeService(() => tables)
    const project = createDefaultProject()
    project.sample.layers = [createLayer(), createLayer()]
    project.experiment.qzScan.points = 4
    const snapshot = JSON.stringify(project)
    const output = {}
    try {
      // AC-3: use the actual importer and unmodified public fixture through the real worker.
      if (!precisionFixture.includes('precision = 1')) throw new Error('Missing precision fixture key')
      output.precision = []
      for (const precision of [1, 0, 2, 3]) {
        const imported = importAllFile(precisionFixture.replace('precision = 1', `precision = ${precision}`))
        const before = JSON.stringify(imported.project)
        const result = await service.calcReflectivity(imported.project)
        const values = new Float64Array(result.reflectivity)
        output.precision.push({ precision, bytes: Array.from(new Uint8Array(values.buffer)),
          qz: result.qz, values: Array.from(values),
          reported: imported.report.messages.some(message => message.text.includes(`precision = ${precision}`)),
          unchanged: before === JSON.stringify(imported.project) })
      }
      output.zero = await service.calcReflectivity(project)
      output.asymmetry = await service.calcAsymmetry(project)
      try { await service.depthProfile(project) } catch (error) { output.unsupported = error.message }
      output.originalUnchanged = snapshot === JSON.stringify(project)
      project.sample.layers[0].delta = .01
      project.sample.layers[0].beta = .002
      project.experiment.qzScan.qzMin = 0
      project.experiment.qzScan.qzMax = 0
      output.totalReflection = await service.calcReflectivity(project)
      const postProject = structuredClone(project)
      postProject.experiment.qzScan.points = 2
      postProject.experiment.qzScan.qzMax = .02
      postProject.experiment.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
      output.postBaseline = await service.calcReflectivity(postProject)
      output.postEnergy = postProject.experiment.energy
      postProject.calculation.postProcessing.multiplyByQz4 = true
      postProject.calculation.postProcessing.divideByCos2ThetaSquared = true
      postProject.calculation.averaging = 1
      output.postprocessed = await service.calcReflectivity(postProject)
      const resolutionProject = createDefaultProject()
      resolutionProject.sample.layers = [createLayer({ delta: .01, beta: .002 }), createLayer()]
      resolutionProject.experiment.energy = 640
      resolutionProject.experiment.polarization.beam1 = { sigma: { re: 1, im: 0 }, pi: { re: 0, im: 0 } }
      resolutionProject.experiment.resolution.angularFwhm = .002
      resolutionProject.experiment.resolution.fastConvolution = false
      resolutionProject.experiment.qzScan.points = 2
      output.resolution = []
      for (const qz of [0, .03]) {
        resolutionProject.experiment.qzScan.qzMin = qz
        resolutionProject.experiment.qzScan.qzMax = qz
        output.resolution.push((await service.calcReflectivity(resolutionProject)).reflectivity[0])
      }
      const fitInput = structuredClone(resolutionProject)
      const fitPolarization = structuredClone(fitInput.experiment.polarization)
      fitPolarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
      fitInput.datasets = [{ title: '', comment: '', sourceFile: '', energy: 650, energyShift: 3,
        angularResolution: .001, intensityScale: 2, intensityOffset: .5, qzShift: -.001,
        errorWeight: 4, polarization: fitPolarization, active: true,
        columns: { qz: [.03, .01, .02], reflectivity: [1, 2, 3] } }]
      const fitSnapshot = JSON.stringify(fitInput)
      const preparedFit = prepareFitDataset(fitInput, 0)
      output.fitPrepared = await service.calcReflectivity(preparedFit.project)
      output.fitMeasurement = preparedFit.measurement
      output.fitInputUnchanged = fitSnapshot === JSON.stringify(fitInput)
      const fitBaseline = structuredClone(fitInput)
      fitBaseline.activeDatasetIndex = 0
      fitBaseline.experiment.energy = 650
      fitBaseline.experiment.polarization = fitPolarization
      fitBaseline.experiment.resolution.angularFwhm = .001
      fitBaseline.experiment.qzScan.useDatasetPoints = true
      fitBaseline.datasets[0].qzShift = 0
      fitBaseline.datasets[0].columns.qz = [.03 - .001, .01 - .001, .02 - .001]
      output.fitBaseline = await service.calcReflectivity(fitBaseline)
      const automatic = structuredClone(resolutionProject)
      automatic.calculation.automaticOpticalConstants = true
      automatic.sample.layers.forEach((layer, index) => { layer.opticalTable = index ? 'ambient' : 'film'; layer.deltaMag = 7; layer.betaMag = 8 })
      tables = [
        { name: 'film', kind: 'db', energy: [639, 641], columns: [[.009, .011], [.001, .003]], warnings: [] },
        { name: 'ambient', kind: 'db', energy: [639, 641], columns: [[0, 0], [0, 0]], warnings: [] },
        { name: 'film', kind: 'm', energy: [700, 800], columns: [[1, 2], [3, 4]], warnings: [] },
      ]
      const automaticSnapshot = JSON.stringify(automatic)
      const tableSnapshot = JSON.stringify(tables)
      output.automatic = await service.calcReflectivity(automatic)
      output.automaticBaseline = await service.calcReflectivity(resolutionProject)
      output.refreshUnchanged = automaticSnapshot === JSON.stringify(automatic) && tableSnapshot === JSON.stringify(tables)
      // Replace the session table and compare both magnetic beams with explicit constants.
      tables[2] = { ...tables[2], energy: [639, 641], columns: [[.001, .003], [.0001, .0003]] }
      automatic.calculation.magnetization.mode = 'add'
      const explicit = structuredClone(resolutionProject)
      explicit.calculation.magnetization.mode = 'add'
      explicit.sample.layers[0].deltaMag = .002
      explicit.sample.layers[0].betaMag = .0002
      output.automaticMagnetic = await service.calcAsymmetry(automatic)
      output.magneticBaseline = await service.calcAsymmetry(explicit)
      const energyProject = structuredClone(resolutionProject)
      energyProject.sample.layers.forEach((layer, index) => { layer.opticalTable = index ? 'ambient' : 'film' })
      energyProject.experiment.energyScan = { energyMin: 639.25, energyMax: 640.75, fixed: 'qz', qz: .03, angle: 2 }
      energyProject.experiment.qzScan.points = 4
      output.energyScan = await service.calcEnergyScan(energyProject)
      output.energyReference = []
      for (const energy of output.energyScan.energy) {
        const reference = structuredClone(resolutionProject)
        reference.experiment.energy = energy
        const fraction = (12398.326 / (12398.326 / energy) - 639) / 2
        reference.sample.layers[0].delta = .009 + (.011 - .009) * fraction
        reference.sample.layers[0].beta = .001 + (.003 - .001) * fraction
        output.energyReference.push((await service.calcReflectivity(reference)).reflectivity[0])
      }
      energyProject.experiment.resolution.energyFwhm = .4
      output.energyResolved = await service.calcEnergyScan(energyProject)
      energyProject.calculation.magnetization.mode = 'add'
      energyProject.experiment.polarization.beam2 = { sigma: { re: .8, im: .2 }, pi: { re: .3, im: .1 } }
      output.dichroicEnergy = await service.calcEnergyAsymmetry(energyProject)
      output.dichroicRawReference = []
      for (const energy of output.dichroicEnergy.energy) {
        const reference = structuredClone(resolutionProject)
        reference.calculation.magnetization.mode = 'add'
        reference.experiment.polarization = energyProject.experiment.polarization
        reference.experiment.energy = energy
        const fraction = (12398.326 / (12398.326 / energy) - 639) / 2
        Object.assign(reference.sample.layers[0], {
          delta: .009 + (.011 - .009) * fraction, beta: .001 + (.003 - .001) * fraction,
          deltaMag: .001 + (.003 - .001) * fraction, betaMag: .0001 + (.0003 - .0001) * fraction,
        })
        const curve = await service.calcAsymmetry(reference)
        output.dichroicRawReference.push(curve.reflectivityPlus[0], curve.reflectivityMinus[0])
      }
      energyProject.calculation.asymmetryDefinition = 'difference'
      output.differenceEnergy = await service.calcEnergyAsymmetry(energyProject)
      tables = tables.filter(table => table.name !== 'ambient')
      try { await service.calcReflectivity(automatic) } catch (error) { output.missingTable = error.message }
      tables = []
      const matrix = createDefaultProject()
      matrix.calculation.algorithm = 'matrix'
      matrix.calculation.epsilon = 1e-8
      matrix.sample.layers = [
        createLayer({ thickness: 0, roughness: 2, delta: .01, beta: .002, deltaMag: .001, betaMag: .0001, magnetization: { gamma: 30, phi: 60 } }),
        createLayer({ thickness: 20, roughness: 1, delta: .006, beta: .001, deltaMag: .0004, betaMag: .00004, magnetization: { gamma: 45, phi: 70 } }),
        createLayer(),
      ]
      matrix.sample.multilayer = { enabled: true, pattern: '2*(1)' }
      matrix.experiment.energy = 640
      matrix.experiment.qzScan = { ...matrix.experiment.qzScan, qzMin: 0, qzMax: .04, points: 4 }
      matrix.experiment.resolution.angularFwhm = .001
      matrix.experiment.resolution.fastConvolution = false
      matrix.experiment.polarization = { analyzer: 'none',
        beam1: { sigma: { re: 1, im: .2 }, pi: { re: .3, im: -.1 } },
        beam2: { sigma: { re: .2, im: -.3 }, pi: { re: .4, im: .1 } } }
      output.matrix = []
      output.matrixMono = []
      for (const [tensor, magnetic] of [['magnetic', 'add'], ['tetragonal', 'none']]) {
        matrix.calculation.tensorContribution = tensor
        matrix.calculation.magnetization.mode = magnetic
        output.matrix.push(await service.calcAsymmetry(matrix))
        output.matrixMono.push(await service.calcReflectivity(matrix))
      }
      matrix.calculation.tensorContribution = 'magnetic'
      matrix.calculation.magnetization.mode = 'add'
      const zakManual = structuredClone(matrix)
      zakManual.calculation.algorithm = 'zak'
      output.zakManual = []
      output.zakMono = []
      for (const mode of ['add', 'none']) {
        zakManual.calculation.magnetization.mode = mode
        output.zakManual.push(await service.calcAsymmetry(zakManual))
        output.zakMono.push(await service.calcReflectivity(zakManual))
      }
      matrix.calculation.automaticOpticalConstants = true
      matrix.sample.layers.forEach((layer, index) => {
        layer.opticalTable = `matrix-${index}`
        tables.push({ name: layer.opticalTable, kind: 'db', energy: [639, 641], columns: [[layer.delta, layer.delta], [layer.beta, layer.beta]], warnings: [] })
        tables.push({ name: layer.opticalTable, kind: 'm', energy: [639, 641], columns: [[layer.deltaMag, layer.deltaMag], [layer.betaMag, layer.betaMag]], warnings: [] })
        layer.delta = layer.beta = layer.deltaMag = layer.betaMag = 0
      })
      const matrixSnapshot = JSON.stringify(matrix)
      output.matrixAutomatic = await service.calcAsymmetry(matrix)
      output.matrixUnchanged = matrixSnapshot === JSON.stringify(matrix)
      matrix.calculation.postProcessing.multiplyByQz4 = true
      output.matrixPostprocessed = await service.calcReflectivity(matrix)
      matrix.calculation.postProcessing.multiplyByQz4 = false
      matrix.experiment.energyScan = { ...matrix.experiment.energyScan,
        energyMin: 639.25, energyMax: 640.75, fixed: 'qz', qz: .03 }
      matrix.experiment.resolution.fastConvolution = true // energy scans still use exact angular convolution
      for (const table of tables) for (const column of table.columns) column[1] *= 1.1
      output.matrixEnergyRaw = await service.calcEnergyAsymmetry(matrix)
      output.matrixEnergyReference = []
      for (const energy of output.matrixEnergyRaw.energy) {
        const reference = structuredClone(matrix)
        reference.experiment.energy = energy
        reference.experiment.resolution.fastConvolution = false
        reference.experiment.qzScan.qzMin = reference.experiment.qzScan.qzMax = .03
        const curve = await service.calcAsymmetry(reference)
        output.matrixEnergyReference.push(curve.reflectivityPlus[0], curve.reflectivityMinus[0])
      }
      matrix.experiment.resolution.energyFwhm = .4
      const energySnapshot = JSON.stringify(matrix)
      output.matrixEnergyResolved = await service.calcEnergyAsymmetry(matrix)
      output.matrixEnergyMono = await service.calcEnergyScan(matrix)
      output.matrixEnergyUnchanged = energySnapshot === JSON.stringify(matrix)
      matrix.calculation.asymmetryDefinition = 'difference'
      output.matrixEnergyDifference = await service.calcEnergyAsymmetry(matrix)
      const tensorRows = [
        [.98, .002, .0002, .0001, 0, 0, -.0002, -.0001, .985, .003, 0, 0, 0, 0, 0, 0, .99, .001],
        [.97, .002, .0002, .0001, 0, 0, -.0002, -.0001, .985, .003, 0, 0, 0, 0, 0, 0, .99, .001],
      ]
      tensorRows.forEach((values, index) => tables.push({ name: `matrix-${index}`, kind: 'e', energy: [639, 641],
        columns: values.map(value => [value, value * 1.001]), warnings: [] }))
      matrix.calculation.magnetization.mode = 'none'
      matrix.calculation.tensorContribution = 'tetragonal'
      matrix.calculation.asymmetryDefinition = 'normalized'
      matrix.experiment.resolution.fastConvolution = false
      const tensorSnapshot = JSON.stringify(matrix)
      output.importedTensorQz = await service.calcAsymmetry(matrix)
      output.importedTensorEnergy = await service.calcEnergyAsymmetry(matrix)
      output.importedTensorUnchanged = tensorSnapshot === JSON.stringify(matrix)
      for (const table of tables) if (table.kind === 'e') table.energy = [700, 710]
      try { await service.calcReflectivity(matrix) } catch (error) { output.tensorOutsideRange = error.message }
      const zak = structuredClone(matrix)
      zak.calculation.algorithm = 'zak'
      zak.calculation.magnetization.mode = 'add'
      const zakSnapshot = JSON.stringify(zak)
      // Nonempty out-of-range .e tables are read, but Zak uses scalar .db/.m fields.
      output.zakAutomatic = await service.calcAsymmetry(zak)
      zak.experiment.resolution.fastConvolution = true // energy path remains exact
      output.zakEnergy = await service.calcEnergyAsymmetry(zak)
      output.zakEnergyMono = await service.calcEnergyScan(zak)
      zak.experiment.resolution.fastConvolution = false
      output.zakUnchanged = zakSnapshot === JSON.stringify(zak)
      zak.calculation.asymmetryDefinition = 'difference'
      output.zakDifference = await service.calcEnergyAsymmetry(zak)
      zak.calculation.magnetization.mode = 'profile'
      try { await service.calcReflectivity(zak) } catch (error) { output.zakProfileError = error.message }
      tables = tables.filter(table => table.kind !== 'e')
      matrix.calculation.magnetization.mode = 'profile'
      try { await service.calcReflectivity(matrix) } catch (error) { output.matrixProfileError = error.message }
      tables = []
      // Queue a genuine large WASM request, then Stop using the production service lifecycle.
      const busy = structuredClone(project)
      busy.sample.layers = Array.from({ length: 1000 }, (_, index) => createLayer({ thickness: 10, delta: index % 2 ? .001 : .002, beta: .0001 }))
      busy.experiment.qzScan.points = 100000
      busy.experiment.qzScan.qzMax = .1
      let entryTimeout
      const entered = new Promise((resolve, reject) => {
        enteredResolve = resolve
        entryTimeout = setTimeout(() => reject(new Error('Real core did not start')), 10000)
      })
      const pending = service.calcReflectivity(busy).then(() => 'finished', error => error.name)
      try { await entered } finally { clearTimeout(entryTimeout) }
      const start = performance.now()
      service.stop()
      output.stopped = await pending
      output.restarted = await service.calcReflectivity(project)
      output.recoveryMilliseconds = performance.now() - start
      return output
    } finally { service.dispose(); window.Worker = NativeWorker }
  })
  assert.equal(results.fitInputUnchanged, true)
  assert.deepEqual(results.fitPrepared, results.fitBaseline)
  assert.deepEqual(results.fitPrepared.qz, results.fitMeasurement.qz)
  assert.deepEqual(results.fitMeasurement.reflectivity, [3, 5, 7])
  assert.equal(results.precision.length, 4)
  const precisionBaseline = results.precision[0]
  assert.ok(precisionBaseline.values.length > 1)
  assert.ok(precisionBaseline.values.every(Number.isFinite))
  assert.ok(precisionBaseline.values.some(value => value > 0))
  assert.ok(new Set(precisionBaseline.values).size > 1)
  for (const item of results.precision) {
    assert.equal(item.reported, true, `precision ${item.precision} missing from import report`)
    assert.equal(item.unchanged, true)
    assert.deepEqual(item.qz, precisionBaseline.qz)
    assert.deepEqual(item.bytes, precisionBaseline.bytes, `precision ${item.precision} changed result bits`)
  }
  assert.deepEqual(results.zero.reflectivity, [0, 0, 0, 0])
  assert.deepEqual(results.asymmetry.asymmetry, [0, 0, 0, 0])
  assert.match(results.unsupported, /does not support depthProfile/)
  for (const value of results.totalReflection.reflectivity) assert.ok(Math.abs(value - 1) <= 1e-10 + 1e-15)
  const corrected = results.postBaseline.qz.map((qz, index) => {
    const wave = 2 * Math.PI / (12398.326 / results.postEnergy)
    const angle = Math.asin(qz / (2 * wave))
    return results.postBaseline.reflectivity[index] * (qz * qz * qz * qz) / (Math.cos(2 * angle) * Math.cos(2 * angle))
  })
  const mean = (corrected[0] + corrected[1]) / 2
  assert.equal(results.postprocessed.reflectivity[0], 0) // legacy unsigned leading-window behavior
  assert.ok(Math.abs(results.postprocessed.reflectivity[1] - mean) <= 1e-15 + 1e-10 * Math.abs(mean))
  // Synthetic original CParratt<double> values, weighted with the active legacy
  // 19-node kernel at energy 640 eV and width .002 inverse Angstrom.
  const resolutionReference = [.56005877016968919, .87413289596007782]
  results.resolution.forEach((value, index) => assert.ok(Math.abs(value - resolutionReference[index]) <= 1e-15 + 1e-10 * Math.abs(resolutionReference[index])))
  for (const [actual, expected] of [[results.automatic, results.automaticBaseline], [results.automaticMagnetic, results.magneticBaseline]]) {
    for (const key of Object.keys(expected)) actual[key].forEach((value, index) => {
      assert.ok(Math.abs(value - expected[key][index]) <= 1e-15 + 1e-10 * Math.abs(expected[key][index]), `Automatic refresh ${key}[${index}]`)
    })
  }
  assert.equal(results.energyScan.energy.length, 5)
  results.energyScan.reflectivity.forEach((value, index) => assert.ok(Math.abs(value - results.energyReference[index]) <= 1e-15 + 1e-10 * Math.abs(results.energyReference[index])))
  const convolutionReference = JSON.parse(execFileSync('node', ['--experimental-strip-types', resolve(root, 'engine/tests/compare_resolution.mjs')], {
    input: JSON.stringify([{ qz: results.energyScan.energy, raw: results.energyScan.reflectivity.flatMap(value => [value, 0]), width: .4, fast: true, dichroic: false }]), encoding: 'utf8',
  }))[0].values
  results.energyResolved.reflectivity.forEach((value, index) => assert.ok(Math.abs(value - convolutionReference[index * 2]) <= 1e-15 + 1e-10 * Math.abs(convolutionReference[index * 2])))
  const dichroicReference = JSON.parse(execFileSync('node', ['--experimental-strip-types', resolve(root, 'engine/tests/compare_resolution.mjs')], {
    input: JSON.stringify([{ qz: results.dichroicEnergy.energy, raw: results.dichroicRawReference, width: .4, fast: true, dichroic: true }]), encoding: 'utf8',
  }))[0].values
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-15 + 1e-10 * Math.abs(expected))
  results.dichroicEnergy.energy.forEach((_, index) => {
    const plus = dichroicReference[index * 2], minus = dichroicReference[index * 2 + 1]
    near(results.dichroicEnergy.reflectivityPlus[index], plus)
    near(results.dichroicEnergy.reflectivityMinus[index], minus)
    near(results.dichroicEnergy.asymmetry[index], (plus - minus) / (plus + minus))
    near(results.differenceEnergy.asymmetry[index], plus - minus)
  })
  const matrixReferences = JSON.parse(execFileSync('python3', [resolve(root, 'engine/tests/test_visnovsky.py'),
    resolve(root, 'build/engine/libremagx_core.so'), '--worker-reference'], { encoding: 'utf8' }))
  results.matrix.forEach((curve, variant) => curve.qz.forEach((qz, index) => {
    const plus = matrixReferences[variant][index * 2], minus = matrixReferences[variant][index * 2 + 1]
    near(curve.reflectivityPlus[index], plus)
    near(curve.reflectivityMinus[index], minus)
    near(curve.asymmetry[index], (plus - minus) / (plus + minus))
    near(results.matrixMono[variant].reflectivity[index], plus)
    if (variant === 0) {
      near(results.matrixAutomatic.reflectivityPlus[index], plus)
      near(results.matrixAutomatic.reflectivityMinus[index], minus)
      near(results.matrixPostprocessed.reflectivity[index], plus * (qz * qz * qz * qz))
    }
  }))
  results.matrixEnergyRaw.energy.forEach((_, index) => {
    near(results.matrixEnergyRaw.reflectivityPlus[index], results.matrixEnergyReference[index * 2])
    near(results.matrixEnergyRaw.reflectivityMinus[index], results.matrixEnergyReference[index * 2 + 1])
  })
  const matrixEnergyReference = JSON.parse(execFileSync('node', ['--experimental-strip-types', resolve(root, 'engine/tests/compare_resolution.mjs')], {
    input: JSON.stringify([{ qz: results.matrixEnergyRaw.energy, raw: results.matrixEnergyReference,
      width: .4, fast: true, dichroic: true }]), encoding: 'utf8',
  }))[0].values
  results.matrixEnergyResolved.energy.forEach((_, index) => {
    const plus = matrixEnergyReference[index * 2], minus = matrixEnergyReference[index * 2 + 1]
    near(results.matrixEnergyResolved.reflectivityPlus[index], plus)
    near(results.matrixEnergyResolved.reflectivityMinus[index], minus)
    near(results.matrixEnergyResolved.asymmetry[index], (plus - minus) / (plus + minus))
    near(results.matrixEnergyMono.reflectivity[index], plus)
    near(results.matrixEnergyDifference.asymmetry[index], plus - minus)
  })
  assert.equal(results.matrixEnergyUnchanged, true)
  const tensorReferences = JSON.parse(execFileSync('python3', [resolve(root, 'engine/tests/test_visnovsky.py'),
    resolve(root, 'build/engine/libremagx_core.so'), '--tensor-table-reference'], { encoding: 'utf8' }))
  for (const [curve, expected] of [[results.importedTensorQz, tensorReferences.qz], [results.importedTensorEnergy, tensorReferences.energy]]) {
    curve.reflectivityPlus.forEach((plus, index) => {
      near(plus, expected[index * 2])
      near(curve.reflectivityMinus[index], expected[index * 2 + 1])
      near(curve.asymmetry[index], (expected[index * 2] - expected[index * 2 + 1]) / (expected[index * 2] + expected[index * 2 + 1]))
    })
  }
  assert.equal(results.importedTensorUnchanged, true)
  assert.match(results.tensorOutsideRange, /nonfinite numerical result/)
  const zakReferences = JSON.parse(execFileSync('python3', [resolve(root, 'engine/tests/test_zak.py'),
    resolve(root, 'build/engine/libremagx_core.so'), '--worker-reference'], { encoding: 'utf8' }))
  results.zakManual.forEach((curve, variant) => curve.qz.forEach((_, index) => {
    const plus = zakReferences.manual[variant][2 * index], minus = zakReferences.manual[variant][2 * index + 1]
    near(curve.reflectivityPlus[index], plus)
    near(curve.reflectivityMinus[index], minus)
    near(results.zakMono[variant].reflectivity[index], plus)
  }))
  results.zakAutomatic.qz.forEach((_, index) => {
    near(results.zakAutomatic.reflectivityPlus[index], zakReferences.automatic[2 * index])
    near(results.zakAutomatic.reflectivityMinus[index], zakReferences.automatic[2 * index + 1])
  })
  results.zakEnergy.energy.forEach((_, index) => {
    const plus = zakReferences.energy[2 * index], minus = zakReferences.energy[2 * index + 1]
    near(results.zakEnergy.reflectivityPlus[index], plus)
    near(results.zakEnergy.reflectivityMinus[index], minus)
    near(results.zakEnergy.asymmetry[index], (plus - minus) / (plus + minus))
    near(results.zakDifference.asymmetry[index], plus - minus)
    near(results.zakEnergyMono.reflectivity[index], plus)
  })
  assert.equal(results.zakUnchanged, true)
  assert.match(results.zakProfileError, /profile/)
  assert.equal(results.matrixUnchanged, true)
  assert.match(results.matrixProfileError, /profile/)
  assert.equal(results.refreshUnchanged, true)
  assert.match(results.missingTable, /missing optical table ambient/)
  assert.equal(results.stopped, 'ComputeCancelled')
  assert.deepEqual(results.restarted, results.totalReflection)
  assert.ok(results.recoveryMilliseconds < 1000, `Stop and restart took ${results.recoveryMilliseconds} ms`)
  assert.equal(results.originalUnchanged, true)
  console.log(`Real ComputeService in Chromium: prepared fit-dataset settings/coordinates, imported precision 0/1/2/3 bit identity, zero contrast, total reflection, asymmetry, postprocessing, angular resolution, automatic optical tables, monochromatic/dichroic energy scans, both asymmetries, matrix qz/energy/imported tensors/multilayers/automatic tables/postprocessing, Zak qz/energy/automatic tables and tensor independence, unsupported operation and Stop/restart passed (${results.recoveryMilliseconds.toFixed(1)} ms).`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
