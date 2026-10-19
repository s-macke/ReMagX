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
for (const file of ['fit_error.mjs', 'optimizer.mjs']) await copyFile(resolve(root, 'engine/wasm', file), resolve(destination, 'assets', file))
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
    const { mountFitPreview, mergeFitResult, applyRealFitParameters, prepareFitDataset, importAllFile, precisionFixture, createDefaultProject, createLayer, createRealComputeService } = window.realServiceHarness
    let enteredResolve
    const workerRequests = []
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      postMessage(message, ...rest) { workerRequests.push(message.kind); return super.postMessage(message, ...rest) }
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
      // Actual BeforeCalculation Lua through the worker, compared with manually edited input.
      tables = [{ name: 'lua-film', kind: 'db', energy: [600, 900], columns: [[.006, .006], [.001, .001]], warnings: [] }]
      for (const algorithm of ['parratt', 'matrix', 'zak']) for (const automatic of [false, true]) {
        const scripted = createDefaultProject()
        scripted.sample.layers = [createLayer({ opticalTable: 'lua-film', delta: .006, beta: .001 }),
          createLayer({ opticalTable: 'lua-film', thickness: 20, delta: .006, beta: .001 }),
          createLayer({ opticalTable: 'lua-film', delta: .006, beta: .001 })]
        scripted.sample.elementProfiles = [{ element: 'Fe', f1: 26, f2: 1, f1Mag: 2, f2Mag: 3, slabs: [] }]
        scripted.calculation.algorithm = algorithm
        scripted.calculation.automaticOpticalConstants = automatic
        scripted.experiment.energy = 700
        scripted.experiment.qzScan.points = 12
        scripted.scripts.enabled = true
        scripted.scripts.beforeCalculation = 'assert(select("#", CalculateDicReflectivity()) == 0); assert(select("#", CalculateEnergyscan(false, nil, "ignored")) == 0); thickness[1] = 35; energy = 710; delta[1] = GetGaussLorentzianImag(700, 0.004, 1, 50); beta[1] = GetGaussLorentzianReal(700, 0.000003, 0.1, 25); resolution = 0.002; FillTensors(); print("script=", energy)'
        const before = JSON.stringify(scripted)
        const expected = structuredClone(scripted)
        expected.scripts.enabled = false
        expected.calculation.automaticOpticalConstants = false
        expected.sample.layers[1].thickness = 35
        expected.sample.layers[1].delta = .004
        // Independent native helper result at stored energy 700, before Lua readback.
        expected.sample.layers[1].beta = 1.3079915851729437e-6
        expected.experiment.energy = 710
        expected.experiment.resolution.angularFwhm = .002
        for (const method of ['calcReflectivity', 'calcAsymmetry']) {
          const actualCurve = await service[method](scripted), expectedCurve = await service[method](expected)
          for (const key of ['reflectivity', 'reflectivityPlus', 'reflectivityMinus', 'asymmetry']) {
            if (!expectedCurve[key]) continue
            actualCurve[key].forEach((value, index) => {
              const reference = expectedCurve[key][index]
              if (Math.abs(value-reference) > 1e-15 + 1e-10*Math.abs(reference)) throw new Error(`Lua ${algorithm}/${method}/${key} mismatch`)
            })
          }
          if (JSON.stringify(actualCurve.scriptMessages) !== '["script=710"]') throw new Error('Missing Lua output')
        }
        if (automatic) {
          const repair = structuredClone(scripted)
          repair.sample.layers[0].opticalTable = 'missing'
          repair.sample.layers[1].opticalTable = 'outside'
          repair.sample.layers[1].delta = .123
          tables.push({ name: 'outside', kind: 'db', energy: [100, 200], columns: [[.3, .4], [.1, .2]], warnings: [] })
          const actual = await service.calcAsymmetry(repair), reference = await service.calcAsymmetry(expected)
          for (const key of ['reflectivityPlus', 'reflectivityMinus', 'asymmetry']) actual[key].forEach((value, index) => {
            if (Math.abs(value-reference[key][index]) > 1e-15 + 1e-10*Math.abs(reference[key][index])) throw new Error(`Lua repair ${algorithm} mismatch`)
          })
          tables.pop()
          tables.push({ name: 'lua-override', kind: 'db', energy: [600, 900], columns: [[.004, .004], [.001, .001]], warnings: [] })
          const renamed = structuredClone(scripted)
          renamed.scripts.beforeCalculation = 'thickness[1] = 35; energy = 710; resolution = 0.002; SetName(1, "lua-override"); SetDeltaBeta(1, 710); FillTensors()'
          const renamedExpected = structuredClone(expected)
          renamedExpected.sample.layers[1].beta = .001
          const renamedCurve = await service.calcReflectivity(renamed), renamedReference = await service.calcReflectivity(renamedExpected)
          renamedCurve.reflectivity.forEach((value, index) => {
            if (Math.abs(value-renamedReference.reflectivity[index]) > 1e-15 + 1e-10*Math.abs(renamedReference.reflectivity[index])) throw new Error(`Lua first-table resolution ${algorithm} mismatch`)
          })
          tables.pop()
        }
        scripted.scripts.beforeCalculation = 'delta[1] = 0.1\nlocal x = 1\nerror("broken calculation")'
        let failed = false
        try { await service.calcReflectivity(scripted) } catch (error) { failed = /BeforeCalculation:3:/.test(error.message) }
        if (!failed) throw new Error('Missing Lua line-3 error')
        scripted.scripts.beforeCalculation = JSON.parse(before).scripts.beforeCalculation
        if (JSON.stringify(scripted) !== before) throw new Error('Script changed caller project')
      }
      // Energy hooks: independently calculate each valid point, then convolve
      // against the original measurement grid (including the skipped point).
      const energyCore = await (await import('/assets/remagx-core.mjs')).default()
      const { convolveEnergy } = await import('/assets/parratt.mjs')
      tables = [
        { name: 'script-bulk', kind: 'db', energy: [600, 700], columns: [[.01, .01], [.002, .002]], warnings: [] },
        { name: 'script-film', kind: 'db', energy: [600, 700], columns: [[.006, .006], [.001, .001]], warnings: [] },
        { name: 'script-air', kind: 'db', energy: [600, 700], columns: [[0, 0], [0, 0]], warnings: [] },
      ]
      for (const algorithm of ['parratt', 'matrix', 'zak']) for (const dichroic of [false, true]) {
        const scripted = createDefaultProject()
        scripted.sample.elementProfiles = [{ element: 'Fe', f1: 26, f2: 1, f1Mag: 2, f2Mag: 3, slabs: [] }]
        scripted.calculation.algorithm = algorithm; scripted.calculation.automaticOpticalConstants = false
        scripted.calculation.magnetization.mode = 'add'
        scripted.experiment.energy = 640; scripted.experiment.resolution.energyFwhm = .4
        scripted.experiment.qzScan.useDatasetPoints = true
        scripted.sample.layers = [createLayer({ opticalTable: 'script-bulk', delta: .01, beta: .002 }),
          createLayer({ opticalTable: 'script-film', thickness: 20, delta: .006, beta: .001 }), createLayer({ opticalTable: 'script-air' })]
        scripted.datasets = [{ title: '', comment: '', sourceFile: '', energy: 640, energyShift: 0, qzShift: 0,
          angularResolution: 0, intensityScale: 1, intensityOffset: 0, active: true, errorWeight: 1,
          polarization: scripted.experiment.polarization, columns: { energy: [650, 900, 660], qz: [.02, .03, .04], reflectivity: [1, 1, 1] } }]
        scripted.activeDatasetIndex = 0; scripted.scripts.enabled = true
        scripted.scripts.beforeCalculation = 'calls = (calls or 0) + 1; print("energy-call:", calls); thickness[1] = 20 + calls; delta[1] = 0.004 + calls * 0.0001; deltam[1] = 0.0004; energy = energy + 10; resolution = calls * 0.001; epsilon = calls % 2 == 0 and 0.1 or 0.00000001; FillTensors()'
        const before = JSON.stringify(scripted)
        const actual = await (dichroic ? service.calcEnergyAsymmetry(scripted) : service.calcEnergyScan(scripted))
        const raw = []
        for (let index = 0; index < 3; index++) {
          if (index === 1) { raw.push(1, dichroic ? 1 : 0); continue }
          const calls = index === 0 ? 2 : 3
          const reference = structuredClone(scripted)
          reference.scripts.enabled = false; reference.experiment.qzScan.useDatasetPoints = false
          reference.experiment.qzScan.points = 2
          reference.experiment.qzScan.qzMin = reference.experiment.qzScan.qzMax = scripted.datasets[0].columns.qz[index]
          reference.experiment.energy = scripted.datasets[0].columns.energy[index] + (dichroic ? 0 : 10)
          reference.experiment.resolution.angularFwhm = calls * .001; reference.experiment.resolution.fastConvolution = false
          reference.calculation.epsilon = calls % 2 === 0 ? .1 : 1e-8
          Object.assign(reference.sample.layers[1], { thickness: 20 + calls, delta: .004 + calls * .0001, deltaMag: .0004 })
          const point = await (dichroic ? service.calcAsymmetry(reference) : service.calcReflectivity(reference))
          raw.push(dichroic ? point.reflectivityPlus[0] : point.reflectivity[0], dichroic ? point.reflectivityMinus[0] : 0)
        }
        const expected = convolveEnergy(energyCore, [650, 900, 660], new Float64Array(raw), .4)
        for (let index = 0; index < 3; index++) {
          const plus = dichroic ? actual.reflectivityPlus[index] : actual.reflectivity[index]
          if (Math.abs(plus - expected[2 * index]) > 1e-15 + 1e-10 * Math.abs(expected[2 * index])) throw new Error('Energy script first beam mismatch: ' + algorithm)
          if (dichroic && Math.abs(actual.reflectivityMinus[index] - expected[2 * index + 1]) > 1e-15 + 1e-10 * Math.abs(expected[2 * index + 1])) throw new Error('Energy script second beam mismatch: ' + algorithm)
          if (dichroic) {
            const sum = expected[2 * index] + expected[2 * index + 1]
            const asymmetry = sum === 0 ? 0 : (expected[2 * index] - expected[2 * index + 1]) / sum
            if (Math.abs(actual.asymmetry[index] - asymmetry) > 1e-15 + 1e-10 * Math.abs(asymmetry)) throw new Error('Energy script asymmetry mismatch: ' + algorithm)
          }
        }
        if (JSON.stringify(actual.energy) !== '[650,900,660]' || JSON.stringify(actual.scriptMessages) !== '["energy-call:1","energy-call:2","energy-call:3"]') throw new Error('Energy hook coordinates/lifecycle failed')
        if (JSON.stringify(scripted) !== before) throw new Error('Energy script mutated input')
        scripted.scripts.beforeCalculation = 'calls = (calls or 0) + 1\nlocal x = 1\nif calls == 2 then error("energy point failed") end'
        let failed = false
        try { await service.calcEnergyScan(scripted) } catch (error) { failed = /BeforeCalculation:3:/.test(error.message) }
        if (!failed) throw new Error('Missing per-energy script error line')
      }
      tables = []
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
      const missing = structuredClone(automatic); missing.calculation.magnetization.mode = 'none'
      output.missingRetained = await service.calcReflectivity(missing)
      for (const algorithm of ['parratt', 'matrix', 'zak']) {
        const missingEnergy = structuredClone(energyProject)
        missingEnergy.calculation.algorithm = algorithm
        missingEnergy.experiment.resolution.energyFwhm = 0
        missingEnergy.experiment.qzScan.useDatasetPoints = true
        missingEnergy.datasets = [{ title: '', comment: '', sourceFile: '', energy: 640, energyShift: 0, qzShift: 0,
          angularResolution: 0, intensityScale: 1, intensityOffset: 0, errorWeight: 1,
          polarization: missingEnergy.experiment.polarization, active: true,
          columns: { energy: [639.5, 640.5], qz: [.03, .03], reflectivity: [1, 1] } }]
        missingEnergy.activeDatasetIndex = 0
        for (const method of ['calcEnergyScan', 'calcEnergyAsymmetry']) {
          let rejected = false
          try { await service[method](missingEnergy) }
          catch (error) { rejected = /missing optical table/.test(String(error)) }
          if (!rejected) throw new Error(`Standalone energy strict table gate failed for ${algorithm}`)
        }
      }
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
      output.datasetErrors = []
      tables = [
        { name: 'fit-bulk', kind: 'db', energy: [600, 800], columns: [[.01, .01], [.002, .002]], warnings: [] },
        { name: 'fit-film', kind: 'db', energy: [600, 800], columns: [[.006, .006], [.001, .001]], warnings: [] },
        { name: 'fit-air', kind: 'db', energy: [600, 800], columns: [[0, 0], [0, 0]], warnings: [] },
      ]
      for (const algorithm of ['parratt', 'matrix', 'zak']) {
        const aggregate = createDefaultProject()
        aggregate.calculation.algorithm = algorithm
        aggregate.sample.layers = [createLayer({ opticalTable: 'fit-bulk', delta: .01, beta: .002 }),
          createLayer({ opticalTable: 'fit-film', thickness: 20, delta: .006, beta: .001 }), createLayer({ opticalTable: 'fit-air' })]
        aggregate.experiment.energy = 640
        aggregate.experiment.qzScan.useDatasetPoints = true
        aggregate.fit.window = { qzMin: 0, qzMax: 1, energyMin: 620, energyMax: 680 }
        aggregate.fit.occamQ = 100 // Standalone Chi² excludes the optimizer penalty.
        const polarization = { beam1: { sigma: { re: 1, im: 0 }, pi: { re: 0, im: 0 } },
          beam2: { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }, analyzer: 'none' }
        const datasets = []
        for (const energyScan of [false, true]) {
          for (const kind of ['reflectivity', 'asymmetry', 'dichroic']) {
            const data = { title: '', comment: '', sourceFile: '', energy: 640, energyShift: 2,
              angularResolution: .0001, intensityScale: 2, intensityOffset: 0, qzShift: -.001,
              errorWeight: datasets.length + 1, polarization, active: true,
              columns: { qz: [.02, .04, .03], ...(energyScan ? { energy: [640, 650, 660] } : {}) } }
            const baseline = structuredClone(aggregate)
            baseline.datasets = [data]; baseline.activeDatasetIndex = 0
            baseline.experiment.polarization = polarization
            baseline.experiment.resolution.angularFwhm = data.angularResolution
            const curve = kind === 'reflectivity'
              ? await (energyScan ? service.calcEnergyScan(baseline) : service.calcReflectivity(baseline))
              : await (energyScan ? service.calcEnergyAsymmetry(baseline) : service.calcAsymmetry(baseline))
            if (kind === 'reflectivity') data.columns.reflectivity = curve.reflectivity.map(value => value * 10 / 2)
            else if (kind === 'asymmetry') data.columns.asymmetry = curve.asymmetry.map(value => value + .25)
            else {
              data.columns.reflectivityPlus = curve.reflectivityPlus.map(value => value * 10 / 2)
              data.columns.reflectivityMinus = curve.reflectivityMinus.map(value => value * 100 / 2)
            }
            datasets.push(data)
          }
        }
        aggregate.datasets = [...datasets, { ...structuredClone(datasets[0]), active: false, columns: { qz: [] } }]
        aggregate.activeDatasetIndex = 6
        const snapshot = JSON.stringify(aggregate)
        const chi2 = await service.calcChi2(aggregate)
        output.datasetErrors.push({ algorithm, chi2, unchanged: snapshot === JSON.stringify(aggregate) })
        aggregate.fit.parameters = [{ target: 'intensityScale', index: null, elementIndex: null,
          value: 2, step: 0, lowerBound: 0, upperBound: 10 }]
        const parameterSnapshot = JSON.stringify(aggregate)
        const candidate = applyRealFitParameters(aggregate, [4])
        output.datasetErrors.at(-1).candidate = await service.calcChi2(candidate.project)
        output.datasetErrors.at(-1).mappingUnchanged = parameterSnapshot === JSON.stringify(aggregate)
        const ordered = structuredClone(aggregate)
        ordered.fit.parameters = []
        ordered.sample.layers[0].delta *= 1.7
        ordered.sample.layers[1].delta *= 1.7
        ordered.datasets = [{ ...structuredClone(datasets[3]), errorWeight: 0 },
          { ...structuredClone(datasets[0]), errorWeight: 1 }]
        ordered.activeDatasetIndex = 1
        const orderedSnapshot = JSON.stringify(ordered)
        output.datasetErrors.at(-1).energyThenQz = await service.calcChi2(ordered)
        output.datasetErrors.at(-1).orderedUnchanged = orderedSnapshot === JSON.stringify(ordered)
        const independent = structuredClone(ordered)
        independent.experiment.polarization = polarization
        independent.experiment.resolution.angularFwhm = ordered.datasets[1].angularResolution
        const altered = await service.calcReflectivity(independent)
        const measured = ordered.datasets[1].columns.reflectivity.map(value => value * 2)
        output.datasetErrors.at(-1).reverseExpected = altered.reflectivity.reduce((sum, value, index) =>
          sum + (Math.log10(measured[index]) - Math.log10(value)) ** 2, 0) / measured.length
        ordered.datasets.reverse()
        output.datasetErrors.at(-1).qzThenEnergy = await service.calcChi2(ordered)
        aggregate.datasets.forEach(data => { data.active = false })
        output.datasetErrors.at(-1).empty = await service.calcChi2(aggregate)
      }
      output.realFits = []
      for (const algorithm of ['parratt', 'matrix', 'zak']) {
        const fit = createDefaultProject()
        fit.fit.algorithm = 'simplex'; fit.fit.occamQ = 0
        fit.calculation.algorithm = algorithm
        fit.calculation.automaticOpticalConstants = true
        fit.sample.layers = [createLayer({ opticalTable: 'fit-bulk', delta: .01, beta: .002 }),
          createLayer({ opticalTable: 'fit-film', thickness: 35, delta: .006, beta: .001 }), createLayer({ opticalTable: 'fit-air' })]
        fit.experiment.qzScan.points = 80; fit.experiment.qzScan.qzMin = .01; fit.experiment.qzScan.qzMax = .15
        const reference = await service.calcReflectivity(fit)
        fit.datasets = [{ title: '', comment: '', sourceFile: '', energy: fit.experiment.energy, energyShift: 0, qzShift: 0,
          angularResolution: fit.experiment.resolution.angularFwhm, intensityScale: 1, intensityOffset: 0,
          active: true, errorWeight: 1, polarization: fit.experiment.polarization,
          columns: { qz: reference.qz, reflectivity: reference.reflectivity } }]
        fit.activeDatasetIndex = 0
        fit.sample.layers[1].thickness = 30
        fit.fit.parameters = [{ target: 'thickness', index: 1, elementIndex: null, value: 30, step: 0, lowerBound: 20, upperBound: 50 }]
        const before = JSON.stringify(fit), iterations = []
        let preview
        const plot = mountFitPreview(fit)
        const requestStart = workerRequests.length
        const result = await service.startFit(fit, progress => {
          iterations.push(progress.iteration)
          if (progress.datasetPreview) { preview = progress.datasetPreview; plot.update(preview) }
        })
        await new Promise(resolve => setTimeout(resolve, 150)) // longer than the automatic redraw debounce
        const previewRequests = workerRequests.slice(requestStart)
        const rendered = plot.rendered()
        plot.dispose()
        const completedCurve = await service.calcReflectivity(result.project)
        output.realFits.push({ algorithm, value: result.values[0], chi2: result.chi2, iterations, preview, completedCurve, rendered, previewRequests, capability: service.providesFitPreviews,
          unchanged: before === JSON.stringify(fit) })
      }
      // Persistent Lua fit hooks: the dataset hook adds five to each candidate.
      // The independently generated measurement above has thickness 35.
      for (const algorithm of ['parratt', 'matrix', 'zak']) {
        const fit = createDefaultProject()
        fit.fit.algorithm = 'simplex'; fit.fit.occamQ = 0
        fit.calculation.algorithm = algorithm; fit.calculation.automaticOpticalConstants = true
        fit.sample.layers = [createLayer({ opticalTable: 'fit-bulk', delta: .01, beta: .002 }),
          createLayer({ opticalTable: 'fit-film', thickness: 35, delta: .006, beta: .001 }), createLayer({ opticalTable: 'fit-air' })]
        fit.experiment.qzScan.points = 40; fit.experiment.qzScan.qzMin = .01; fit.experiment.qzScan.qzMax = .15
        const reference = await service.calcReflectivity(fit)
        fit.datasets = [{ title: '', comment: '', sourceFile: '', energy: fit.experiment.energy, energyShift: 0, qzShift: 0,
          angularResolution: fit.experiment.resolution.angularFwhm, intensityScale: 1, intensityOffset: 0,
          active: true, errorWeight: 1, polarization: fit.experiment.polarization,
          columns: { qz: reference.qz, reflectivity: reference.reflectivity } }]
        fit.activeDatasetIndex = 0; fit.sample.layers[1].thickness = 25
        fit.fit.parameters = [{ target: 'thickness', index: 1, elementIndex: null, value: 25, step: 0, lowerBound: 20, upperBound: 50 }]
        fit.scripts.enabled = true
        fit.scripts.beforeCalculation = 'calls = (calls or 0) + 1; print(renewocs); if calls > 1 and renewocs == 0 then thickness[1] = thickness[1] + 5 end'
        const before = JSON.stringify(fit)
        const result = await service.startFit(fit, () => {})
        if (Math.abs(result.values[0] - 30) > 1e-6 || result.chi2 > 1e-16) throw new Error('Scripted fit recovery failed: ' + algorithm)
        if (result.scriptMessages.length < 5 || result.scriptMessages.some((value, index) => value !== (index % 2 ? '1' : '0'))) throw new Error('Incorrect fit hook lifecycle')
        if (before !== JSON.stringify(fit)) throw new Error('Scripted fit mutated input')
        const chiProject = structuredClone(fit)
        chiProject.datasets.push(structuredClone(chiProject.datasets[0]))
        chiProject.datasets[1].errorWeight = 3
        chiProject.scripts.beforeCalculation = 'calls = (calls or 0) + 1; assert(calls == 1); assert(renewocs == 0); print("chi2:", calls); thickness[1] = thickness[1] + 5'
        const expectedFirst = structuredClone(chiProject)
        expectedFirst.scripts.enabled = false; expectedFirst.sample.layers[1].thickness = 30
        expectedFirst.datasets[1].active = false
        const expectedSecond = structuredClone(expectedFirst)
        expectedSecond.sample.layers[1].thickness = 35
        expectedSecond.datasets[0].active = false; expectedSecond.datasets[1].active = true
        const expectedError = await service.calcChi2(expectedFirst) + await service.calcChi2(expectedSecond)
        const chiBefore = JSON.stringify(chiProject), lines = []
        const actualError = await service.calcChi2(chiProject, messages => lines.push(...messages))
        if (Math.abs(actualError - expectedError) > 1e-15 + 1e-10 * Math.abs(expectedError)) throw new Error('Scripted chi2 state mismatch: ' + algorithm)
        if (JSON.stringify(lines) !== '["chi2:1","chi2:1"]' || JSON.stringify(chiProject) !== chiBefore) throw new Error('Scripted chi2 isolation failed')
        for (const failure of ['range', 'missing']) {
          const invalid = structuredClone(chiProject)
          if (failure === 'range') invalid.experiment.energy = 900
          else invalid.sample.layers[0].opticalTable = 'not-imported'
          const prior = JSON.stringify(invalid), emitted = []
          let rejected = false
          try { await service.calcChi2(invalid, messages => emitted.push(...messages)) }
          catch (error) { rejected = (failure === 'range' ? /outside/ : /missing optical table/).test(error.message) }
          if (!rejected || emitted.length || JSON.stringify(invalid) !== prior) throw new Error('Chi2 preflight failed: ' + failure)
        }

        fit.scripts.beforeCalculation = 'local x = 1\nlocal y = 2\nerror("fit script failure")'
        let failed = false
        try { await service.startFit(fit, () => {}) } catch (error) { failed = /BeforeCalculation:3:/.test(error.message) }
        if (!failed) throw new Error('Missing fit script source line')
        await service.calcReflectivity({ ...fit, scripts: { ...fit.scripts, enabled: false } })
      }
      // Exercise recovery separately for each stored data kind, then a weighted mixed fit.
      output.mixedFits = []
      output.fitMerges = []
      tables = [
        { name: 'fit-bulk', kind: 'db', energy: [600, 800], columns: [[.009, .011], [.0015, .0025]], warnings: [] },
        { name: 'fit-film', kind: 'db', energy: [600, 800], columns: [[.005, .007], [.0008, .0012]], warnings: [] },
        { name: 'fit-film', kind: 'm', energy: [600, 800], columns: [[.0003, .0005], [.00003, .00005]], warnings: [] },
        { name: 'fit-air', kind: 'db', energy: [600, 800], columns: [[0, 0], [0, 0]], warnings: [] },
      ]
      for (const algorithm of ['parratt', 'matrix', 'zak']) {
        const fit = createDefaultProject()
        fit.fit.algorithm = 'simplex'; fit.fit.occamQ = 0
        fit.calculation.algorithm = algorithm; fit.calculation.automaticOpticalConstants = true
        fit.calculation.magnetization.mode = 'add'
        fit.sample.layers = [createLayer({ opticalTable: 'fit-bulk' }),
          createLayer({ opticalTable: 'fit-film', thickness: 35, magnetization: { gamma: 45, phi: 70 } }),
          createLayer({ opticalTable: 'fit-air' })]
        fit.experiment.energy = 640; fit.experiment.qzScan.useDatasetPoints = true
        const datasets = [], labels = []
        for (const energyScan of [false, true]) for (const kind of ['reflectivity', 'asymmetry', 'dichroic']) {
          const qz = Array.from({ length: 32 }, (_, index) => .025 + index * .004)
          const data = { title: '', comment: '', sourceFile: '', energy: 640, energyShift: 0, qzShift: 0,
            angularResolution: 0, intensityScale: 1, intensityOffset: 0, active: true, errorWeight: datasets.length + 1,
            polarization: structuredClone(fit.experiment.polarization),
            columns: { qz, ...(energyScan ? { energy: qz.map((_, index) => 610 + index * 5) } : {}) } }
          fit.datasets = [data]; fit.activeDatasetIndex = 0
          const curve = kind === 'reflectivity'
            ? await (energyScan ? service.calcEnergyScan(fit) : service.calcReflectivity(fit))
            : await (energyScan ? service.calcEnergyAsymmetry(fit) : service.calcAsymmetry(fit))
          if (kind === 'reflectivity') data.columns.reflectivity = curve.reflectivity
          else if (kind === 'asymmetry') data.columns.asymmetry = curve.asymmetry
          else { data.columns.reflectivityPlus = curve.reflectivityPlus; data.columns.reflectivityMinus = curve.reflectivityMinus }
          datasets.push(data); labels.push(`${energyScan ? 'energy' : 'qz'}-${kind}`)
        }
        fit.sample.layers[1].thickness = 30
        fit.fit.parameters = [{ target: 'thickness', index: 1, elementIndex: null, value: 30, step: 0, lowerBound: 20, upperBound: 50 }]
        for (let selected = 0; selected <= datasets.length; selected++) {
          fit.datasets = datasets.map((data, index) => ({ ...data, active: selected === datasets.length || selected === index }))
          // Selection must not determine which active datasets enter the fit.
          fit.activeDatasetIndex = (selected + 1) % datasets.length
          const before = JSON.stringify(fit)
          const initial = await service.calcChi2(fit)
          const result = await service.startFit(fit, () => {})
          output.mixedFits.push({ algorithm, kind: labels[selected] ?? 'weighted-mixed', initial,
            value: result.values[0], chi2: result.chi2, unchanged: before === JSON.stringify(fit) })
        }
        // Fit a Lua par[] value against independently generated thickness-35
        // data for each energy kind, then all qz/energy datasets together.
        for (const selected of [3, 4, 5, 6]) {
          const scripted = structuredClone(fit)
          scripted.datasets = datasets.map((data, index) => ({ ...data, active: selected === 6 || selected === index }))
          scripted.scripts.enabled = true; scripted.scripts.parameters = [30]
          scripted.scripts.beforeCalculation = 'calls = (calls or 0) + 1; if calls == 1 then print("init") elseif renewocs == 1 then print("objective") end; thickness[1] = par[0]'
          scripted.fit.parameters = [{ target: 'scriptParameter', index: 0, elementIndex: null, value: 30, step: 0, lowerBound: 20, upperBound: 50 }]
          const before = JSON.stringify(scripted), lines = []
          const manual = structuredClone(scripted); manual.scripts.enabled = false
          const expectedInitial = await service.calcChi2(manual)
          const initial = await service.calcChi2(scripted, messages => lines.push(...messages))
          if (Math.abs(initial - expectedInitial) > 1e-15 + 1e-10 * Math.abs(expectedInitial)) throw new Error('Energy chi2 script mismatch')
          if (lines.length !== scripted.datasets.filter(data => data.active).length || lines.some(line => line !== 'init')) throw new Error('Energy chi2 session lifetime mismatch')
          const fitting = structuredClone(scripted)
          fitting.sample.layers[1].dielectricTensor = { values: Array(18).fill(7), anisotropic: true }
          fitting.scripts.beforeCalculation = 'if calls == nil then assert(math.abs(delta[1] - 0.0054) < 1e-14); assert(math.abs(exx_r[1] - ((1 - 0.0054)^2 - 0.00088^2)) < 1e-14) end; ' + fitting.scripts.beforeCalculation
          const fitBefore = JSON.stringify(fitting)
          const result = await service.startFit(fitting, () => {})
          if (JSON.stringify(fitting) !== fitBefore) throw new Error('Fit preparation changed saved tensor input')
          if (Math.abs(result.values[0] - 35) > 1e-6 || result.chi2 > 1e-16) throw new Error('Energy Lua fit recovery failed: ' + algorithm + '/' + selected)
          if (result.scriptMessages[0] !== 'init' || result.scriptMessages.length < 2 || result.scriptMessages.slice(1).some(line => line !== 'objective')) throw new Error('Energy fit session lifetime mismatch')
          if (JSON.stringify(scripted) !== before) throw new Error('Energy Lua fit mutated project')
        }
      }
      // Native dataset-wide fit results merge into metadata edited during fitting.
      for (const algorithm of ['parratt', 'matrix', 'zak']) {
        const source = createDefaultProject()
        source.fit.algorithm = 'simplex'; source.fit.occamQ = 0
        source.calculation.algorithm = algorithm
        source.sample.layers = [createLayer({ delta: .01, beta: .002 }), createLayer()]
        source.experiment.qzScan.points = 20
        source.experiment.qzScan.qzMin = .02; source.experiment.qzScan.qzMax = .15
        const curve = await service.calcReflectivity(source)
        source.datasets = Array.from({ length: 2 }, (_, index) => ({ title: `fit ${index}`, comment: '', sourceFile: '',
          energy: source.experiment.energy, energyShift: 0, qzShift: 0, angularResolution: 0, intensityScale: 1.8,
          intensityOffset: 0, active: true, errorWeight: index + 1, polarization: source.experiment.polarization,
          columns: { qz: curve.qz.slice(), reflectivity: curve.reflectivity.map(value => value / 2) } }))
        source.activeDatasetIndex = 0
        source.fit.parameters = [{ target: 'intensityScale', index: null, elementIndex: null, value: 1.8, step: 0, lowerBound: 1, upperBound: 3 }]
        const current = { ...source, datasets: source.datasets.map(data => ({ ...data })) }
        current.datasets[1].comment = 'edited while fitting'; current.datasets[1].active = false
        const before = JSON.stringify(current)
        const result = await service.startFit(source, () => {})
        const merged = mergeFitResult(current, source, result)
        output.fitMerges.push({ algorithm, values: merged.datasets.map(data => data.intensityScale),
          updates: result.datasetUpdates.length, active: merged.datasets[1].active, comment: merged.datasets[1].comment,
          selection: merged.activeDatasetIndex, unchanged: before === JSON.stringify(current) })
      }
      output.databaseUpdates = []
      for (const mode of ['compound', 'element']) {
        const databaseProject = createDefaultProject()
        databaseProject.experiment.energy = 150; databaseProject.sample.mode = mode
        databaseProject.sample.layers = [createLayer({ opticalTable: 'sample' }), createLayer({ opticalTable: 'missing' })]
        databaseProject.sample.elementProfiles = ['sample', 'missing'].map(element => ({ element, f1: 7, f2: 8, f1Mag: 9, f2Mag: 10, slabs: [] }))
        const databaseTables = [
          { name: 'sample', kind: mode === 'compound' ? 'db' : 'ff', energy: [100, 200], columns: [[1, 1], [2, 2]], warnings: [] },
          { name: 'sample', kind: mode === 'compound' ? 'm' : 'ffm', energy: [300, 400], columns: [[3, 3], [4, 4]], warnings: [] },
        ]
        const before = JSON.stringify(databaseProject)
        const result = await service.databaseValues(databaseProject, databaseTables)
        output.databaseUpdates.push({ mode, result, unchanged: before === JSON.stringify(databaseProject) })
      }
      const spectrumProject = createDefaultProject()
      spectrumProject.sample.layers = [createLayer({ opticalTable: 'sample', deltaMag: 9, betaMag: 8 })]
      const spectrumTables = [
        { name: 'sample', kind: 'db', energy: [120, 180], columns: [[1, 1], [2, 2]], warnings: [] },
        { name: 'sample', kind: 'm', energy: [100, 150, 200], columns: [[3, 3, 3], [4, 4, 4]], warnings: [] },
      ]
      output.realMagneticSpectrum = await service.layerSpectrum(spectrumProject, { layerIndex: 0, magnetic: true, tables: spectrumTables })
      for (const automatic of [false, true]) {
        const scriptedSpectrum = structuredClone(spectrumProject)
        scriptedSpectrum.experiment.energy = 150
        scriptedSpectrum.calculation.automaticOpticalConstants = automatic
        scriptedSpectrum.scripts.enabled = true
        scriptedSpectrum.scripts.beforeCalculation = 'calls = (calls or 0) + 1; delta[0] = delta[0] + calls; deltam[0] = deltam[0] + calls; print(calls, ":", energy); energy = energy + 7'
        const before = JSON.stringify(scriptedSpectrum)
        for (const magnetic of [false, true]) {
          const streamed = []
          const result = await service.layerSpectrum(scriptedSpectrum, { layerIndex: 0, magnetic, tables: spectrumTables }, lines => streamed.push(...lines))
          const expected = magnetic ? (automatic ? [6, 6, 10] : [12, 6, 10]) : [3, 4]
          const messages = magnetic ? ['1:150', '2:100', '3:150', '4:200'] : ['1:150', '2:120', '3:180']
          if (JSON.stringify(result.first) !== JSON.stringify(expected) || JSON.stringify(streamed) !== JSON.stringify(messages) ||
              JSON.stringify(result.scriptMessages) !== JSON.stringify(messages) || JSON.stringify(scriptedSpectrum) !== before) throw new Error('Scripted compound spectrum mismatch')
        }
        const failureLines = []
        scriptedSpectrum.scripts.beforeCalculation = 'print("spectrum failure output")\nerror("spectrum failed")'
        let failed = false
        try { await service.layerSpectrum(scriptedSpectrum, { layerIndex: 0, magnetic: true, tables: spectrumTables }, lines => failureLines.push(...lines)) }
        catch (error) { failed = /BeforeCalculation:2/.test(String(error)) }
        if (!failed || failureLines[0] !== 'spectrum failure output') throw new Error('Spectrum error/output handling failed')
      }
      spectrumProject.sample.mode = 'element'
      spectrumProject.sample.elementProfiles = [{ element: 'Fe', f1: 7, f2: 8, f1Mag: 0, f2Mag: 0,
        slabs: [{ thickness: 1, roughness: 0, density: 2 }] }]
      const factorTables = [{ name: 'Fe', kind: 'ff', energy: [100, 150, 200], columns: [[26, 26, 26], [.5, .5, .5]], warnings: [] }]
      const spectrumSnapshot = JSON.stringify(spectrumProject)
      output.realFactors = await service.scatteringFactors(spectrumProject, { elementIndex: 0, tables: factorTables })
      output.realElementSpectrum = await service.layerSpectrum(spectrumProject, { elementIndex: 0, layerIndex: 0, magnetic: false, tables: factorTables })
      output.realSpectrumUnchanged = spectrumSnapshot === JSON.stringify(spectrumProject)
      for (const automatic of [false, true]) {
        const scripted = structuredClone(spectrumProject)
        scripted.experiment.energy = 150
        scripted.sample.layers[0].delta = .01
        scripted.calculation.automaticOpticalConstants = automatic
        scripted.scripts.enabled = true
        scripted.scripts.beforeCalculation = 'calls = (calls or 0) + 1; assert(delta[0] == 0.01); thickness[0] = thickness[0] + 10; Fe:setdensity(0, Fe:getdensity(0) + 1); f1[0] = f1[0] + calls; FillTensors(); print(calls, ":", energy); energy = energy + 7'
        const before = JSON.stringify(scripted)
        for (const optical of [false, true]) {
          const lines = []
          const result = optical ? await service.layerSpectrum(scripted, { elementIndex: 0, layerIndex: 0, magnetic: false, tables: factorTables }, text => lines.push(...text))
            : await service.scatteringFactors(scripted, { elementIndex: 0, tables: factorTables }, text => lines.push(...text))
          const expected = [100, 150, 200].map((energy, index) => optical ? (index + 28) * (index + 4) / energy / energy * .0004151761541 * 1e6 : index + 28)
          if (JSON.stringify(result.first) !== JSON.stringify(expected) || JSON.stringify(lines) !== '["1:150","2:100","3:150","4:200"]' ||
              JSON.stringify(result.scriptMessages) !== JSON.stringify(lines) || JSON.stringify(scripted) !== before) throw new Error('Element spectrum Lua/native mismatch')
        }
        scripted.scripts.beforeCalculation = 'print("element error output")\nerror("element failed")'
        for (const optical of [false, true]) {
          const lines = []; let failed = false
          try {
            if (optical) await service.layerSpectrum(scripted, { elementIndex: 0, layerIndex: 0, magnetic: false, tables: factorTables }, text => lines.push(...text))
            else await service.scatteringFactors(scripted, { elementIndex: 0, tables: factorTables }, text => lines.push(...text))
          } catch (error) { failed = /BeforeCalculation:2/.test(String(error)) }
          if (!failed || lines[0] !== 'element error output') throw new Error('Element spectrum error output missing')
        }
      }

      const tensorProject = createDefaultProject()
      tensorProject.experiment.energy = 150
      tensorProject.sample.layers = [createLayer({ opticalTable: 'tensor', delta: .01, beta: .002 })]
      const nativeTensorSnapshot = JSON.stringify(tensorProject)
      output.realScalarTensor = await service.dielectricTensor(tensorProject, { layerIndex: 0, spectrum: false, tables: [] })
      const tensorValues = Array.from({ length: 18 }, (_, index) => (index + 1) / 100)
      output.realTensorSpectrum = await service.dielectricTensor(tensorProject, { layerIndex: 0, spectrum: true, tables: [
        { name: 'tensor', kind: 'db', energy: [120, 180], columns: [[.01, .01], [.002, .002]], warnings: [] },
        { name: 'tensor', kind: 'e', energy: [100, 150, 200], columns: tensorValues.map(value => [value, value, value]), warnings: [] },
      ] })
      output.realTensorUnchanged = nativeTensorSnapshot === JSON.stringify(tensorProject)
      for (const automatic of [false, true]) {
        const scripted = structuredClone(tensorProject)
        scripted.calculation.automaticOpticalConstants = automatic
        scripted.scripts.enabled = true
        scripted.scripts.beforeCalculation = 'calls = (calls or 0) + 1; delta[0] = 100; exx_r[0] = exx_r[0] + calls; exy_i[0] = -calls; ezx_r[0] = calls / 10; print(calls, ":", energy); energy = energy + 7'
        const query = { layerIndex: 0, spectrum: true, tables: [
          { name: 'tensor', kind: 'db', energy: [120, 180], columns: [[.01, .01], [.002, .002]], warnings: [] },
          { name: 'tensor', kind: 'e', energy: [100, 150, 200], columns: tensorValues.map(value => [value, value, value]), warnings: [] },
        ] }
        const snapshot = JSON.stringify(scripted), lines = []
        const result = await service.dielectricTensor(scripted, query, text => lines.push(...text))
        const expected = [automatic ? 3.01 : .99 * .99 - .002 * .002 + 3, 3.01, 7.01]
        result.tensors.forEach((tensor, index) => {
          if (Math.abs(tensor[0].re - expected[index]) > 1e-14 || tensor[1].im !== -(index + 2) || tensor[6].re !== (index + 2) / 10) throw new Error('Scripted tensor spectrum mismatch')
        })
        if (result.source !== 'script' || JSON.stringify(result.energy) !== '[100,150,200]' ||
            JSON.stringify(lines) !== '["1:150","2:100","3:150","4:200"]' ||
            JSON.stringify(result.scriptMessages) !== JSON.stringify(lines) || JSON.stringify(scripted) !== snapshot) throw new Error('Tensor spectrum script lifecycle mismatch')
        scripted.scripts.beforeCalculation = 'delta[0] = 0.2; FillTensors()'
        const rebuilt = await service.dielectricTensor(scripted, query)
        if (rebuilt.tensors.some(tensor => Math.abs(tensor[0].re - (.8 * .8 - .002 * .002)) > 1e-14)) throw new Error('Explicit scripted tensor rebuild failed')
        scripted.scripts.beforeCalculation = 'print("tensor error output")\nerror("tensor failed")'
        const errors = []; let failed = false
        try { await service.dielectricTensor(scripted, query, text => errors.push(...text)) }
        catch (error) { failed = /BeforeCalculation:2/.test(String(error)) }
        if (!failed || errors[0] !== 'tensor error output') throw new Error('Tensor script failure output missing')
        // Single-energy Material Settings snapshots do not execute this spectrum hook.
        await service.dielectricTensor(scripted, { ...query, spectrum: false })
      }

      // Persisted anisotropic tensors in qz scans match an independently
      // prepared imported-.e reference with identical scalar optical values.
      const savedQz = createDefaultProject()
      savedQz.calculation.algorithm = 'matrix'; savedQz.calculation.automaticOpticalConstants = true
      savedQz.experiment.energy = 640; savedQz.experiment.qzScan.points = 8; savedQz.experiment.qzScan.qzMax = .1
      const storedValues = [.96, .001, 0, .002, 0, 0, 0, -.002, .95, .002, 0, 0, 0, 0, 0, 0, .97, .001]
      savedQz.sample.layers = [createLayer({ opticalTable: 'saved-qz', delta: .01, beta: .001,
        dielectricTensor: { values: storedValues, anisotropic: true } }), createLayer({ opticalTable: 'vacuum' })]
      const savedQzBefore = JSON.stringify(savedQz)
      tables = []
      const retainedQz = await service.calcAsymmetry(savedQz)
      const tensorReference = JSON.parse(savedQzBefore)
      delete tensorReference.sample.layers[0].dielectricTensor
      tables = [
        { name: 'saved-qz', kind: 'db', energy: [600, 900], columns: [[.01, .01], [.001, .001]], warnings: [] },
        { name: 'saved-qz', kind: 'e', energy: [600, 900], columns: storedValues.map(value => [value, value]), warnings: [] },
        { name: 'vacuum', kind: 'db', energy: [600, 900], columns: [[0, 0], [0, 0]], warnings: [] },
      ]
      const referenceQz = await service.calcAsymmetry(tensorReference)
      for (const field of ['reflectivityPlus', 'reflectivityMinus', 'asymmetry']) retainedQz[field].forEach((value, index) => {
        if (Math.abs(value - referenceQz[field][index]) > 1e-15 + 1e-10 * Math.abs(referenceQz[field][index])) throw new Error('Saved qz tensor differs from imported tensor reference')
      })
      // Successful scalar refresh must remove the saved tensor override.
      tables = tables.filter(table => table.kind !== 'e')
      const refreshedQz = await service.calcAsymmetry(savedQz)
      const manualQz = JSON.parse(savedQzBefore); manualQz.calculation.automaticOpticalConstants = false
      const rebuiltQz = await service.calcAsymmetry(manualQz)
      for (const field of ['reflectivityPlus', 'reflectivityMinus', 'asymmetry']) refreshedQz[field].forEach((value, index) => {
        if (Math.abs(value - rebuiltQz[field][index]) > 1e-15 + 1e-10 * Math.abs(rebuiltQz[field][index])) throw new Error('Saved qz tensor survived scalar refresh')
      })
      if (!retainedQz.reflectivityPlus.some((value, index) => Math.abs(value - rebuiltQz.reflectivityPlus[index]) > 1e-10)) throw new Error('Stored tensor fixture does not distinguish retained and rebuilt physics')
      if (JSON.stringify(savedQz) !== savedQzBefore) throw new Error('Saved qz tensor input changed')
      tables = []
      const savedScriptQz = JSON.parse(savedQzBefore)
      savedScriptQz.scripts.enabled = true
      savedScriptQz.scripts.beforeCalculation = 'assert(exx_r[0] == 0.96); print("saved-qz-script")'
      const scriptQz = await service.calcAsymmetry(savedScriptQz)
      if (scriptQz.scriptMessages[0] !== 'saved-qz-script') throw new Error('Saved qz tensor was not supplied to Lua')

      // Standalone energy scans strictly replace saved active tensors before
      // the constructor hook, including when automatic constants are disabled.
      for (const automatic of [false, true]) {
        const savedEnergy = JSON.parse(savedQzBefore)
        savedEnergy.calculation.automaticOpticalConstants = automatic
        savedEnergy.sample.layers[0].dielectricTensor.values.fill(7)
        savedEnergy.experiment.qzScan.points = 2
        savedEnergy.experiment.energyScan = { energyMin: 630, energyMax: 650, fixed: 'qz', qz: .03, angle: 2 }
        savedEnergy.scripts.enabled = true
        savedEnergy.scripts.beforeCalculation = 'assert(exx_r[0] == 0.96); calls = (calls or 0) + 1; print(calls)'
        tables = [
          { name: 'saved-qz', kind: 'db', energy: [600, 900], columns: [[.01, .01], [.001, .001]], warnings: [] },
          { name: 'saved-qz', kind: 'e', energy: [600, 900], columns: storedValues.map(value => [value, value]), warnings: [] },
          { name: 'vacuum', kind: 'db', energy: [600, 900], columns: [[0, 0], [0, 0]], warnings: [] },
        ]
        const unchanged = JSON.stringify(savedEnergy)
        const savedEnergyResult = await service.calcEnergyAsymmetry(savedEnergy)
        if (JSON.stringify(savedEnergyResult.scriptMessages) !== '["1","2","3","4"]') throw new Error('Energy constructor did not follow strict refresh')
        const energyReference = JSON.parse(unchanged)
        energyReference.scripts.enabled = false
        delete energyReference.sample.layers[0].dielectricTensor
        const expectedEnergy = await service.calcEnergyAsymmetry(energyReference)
        for (const field of ['reflectivityPlus', 'reflectivityMinus', 'asymmetry']) savedEnergyResult[field].forEach((value, index) => {
          if (Math.abs(value - expectedEnergy[field][index]) > 1e-15 + 1e-10 * Math.abs(expectedEnergy[field][index])) throw new Error('Energy stored-state refresh changed native curves')
        })
        if (JSON.stringify(savedEnergy) !== unchanged) throw new Error('Energy initialization changed saved input')
      }
      tables = []

      // JSON-restored tensor state survives skipped automatic refresh in spectra.
      const storedSpectrum = createDefaultProject()
      storedSpectrum.experiment.energy = 90
      storedSpectrum.calculation.automaticOpticalConstants = true
      storedSpectrum.sample.layers = [createLayer({ opticalTable: 'stored', delta: .01, beta: .002,
        dielectricTensor: { values: Array(18).fill(9), anisotropic: true } }), createLayer()]
      const restoredSpectrum = JSON.parse(JSON.stringify(storedSpectrum))
      const storedBefore = JSON.stringify(restoredSpectrum)
      const retainedTensor = await service.dielectricTensor(restoredSpectrum, { layerIndex: 0, spectrum: false, tables: [] })
      if (retainedTensor.source !== 'stored' || retainedTensor.tensors[0][0].re !== 9) throw new Error('Stored tensor snapshot was lost')
      const storedTables = [
        { name: 'stored', kind: 'db', energy: [120, 180], columns: [[.02, .02], [.003, .003]], warnings: [] },
        { name: 'stored', kind: 'e', energy: [100, 150, 200], columns: Array.from({ length: 18 }, () => [2, 2, 2]), warnings: [] },
      ]
      const retainedSpectrum = await service.dielectricTensor(restoredSpectrum, { layerIndex: 0, spectrum: true, tables: storedTables })
      if (JSON.stringify(retainedSpectrum.tensors.map(tensor => tensor[0].re)) !== '[9,2,2]') throw new Error('Stored tensor spectrum refresh order mismatch')
      restoredSpectrum.scripts.enabled = true
      restoredSpectrum.scripts.beforeCalculation = 'exx_r[0] = exx_r[0] + 1; print(exx_r[0])'
      const retainedScripted = await service.dielectricTensor(restoredSpectrum, { layerIndex: 0, spectrum: true, tables: storedTables })
      if (JSON.stringify(retainedScripted.tensors.map(tensor => tensor[0].re)) !== '[11,3,4]' ||
        JSON.stringify(retainedScripted.scriptMessages) !== '["10","11","3","4"]') throw new Error('Stored tensor script lifecycle mismatch')
      restoredSpectrum.scripts = storedSpectrum.scripts
      if (JSON.stringify(restoredSpectrum) !== storedBefore) throw new Error('Stored spectrum input was mutated')
      restoredSpectrum.calculation.automaticOpticalConstants = false
      const rebuiltStored = await service.dielectricTensor(restoredSpectrum, { layerIndex: 0, spectrum: false, tables: [] })
      if (Math.abs(rebuiltStored.tensors[0][0].re - (.99 * .99 - .002 * .002)) > 1e-14 || rebuiltStored.source !== 'scalar') throw new Error('Manual scalar rebuild retained obsolete tensor')

      // Manual Execute uses its own real Lua session, even with automatic scripts off.
      for (const mode of ['compound', 'element']) for (const automatic of [false, true]) {
        const manual = createDefaultProject()
        manual.sample.mode = mode; manual.experiment.energy = 150
        manual.calculation.automaticOpticalConstants = automatic; manual.scripts.enabled = false
        manual.sample.layers = [createLayer({ opticalTable: 'manual', delta: .01, beta: .002 }), createLayer()]
        manual.sample.elementProfiles = [{ element: 'Fe', f1: 26, f2: 1, f1Mag: 0, f2Mag: 0, slabs: [] }]
        tables = [
          { name: 'manual', kind: 'db', energy: [100, 200], columns: [[.02, .02], [.003, .003]], warnings: [] },
          { name: 'Fe', kind: 'ff', energy: [100, 200], columns: [[28, 28], [2, 2]], warnings: [] },
        ]
        for (const program of ['Default', 'BeforeCalculation']) {
          const key = program === 'Default' ? 'default' : 'beforeCalculation'
          manual.scripts[key === 'default' ? 'beforeCalculation' : 'default'] = 'error("wrong program")'
          manual.scripts[key] = 'print("manual run"); thickness[1] = 23; exx_r[1] = 7; energy = 750'
          const before = JSON.stringify(manual), lines = []
          const result = await service.executeScript(manual, program, messages => lines.push(...messages))
          if (result.project.sample.layers[1].thickness !== 23 || result.project.experiment.energy !== 750 ||
            result.project.scripts.enabled || result.opticalState.dielectricState[1].values[0] !== 7 ||
            JSON.stringify(lines) !== '["manual run"]' || JSON.stringify(result.scriptMessages) !== JSON.stringify(lines) ||
            JSON.stringify(manual) !== before) throw new Error('Manual script publication mismatch')
          const expectedDelta = automatic && mode === 'compound' ? .02 : .01
          const expectedFactor = automatic && mode === 'element' ? 28 : 26
          if (result.project.sample.layers[0].delta !== expectedDelta || result.project.sample.elementProfiles[0].f1 !== expectedFactor) {
            throw new Error('Manual script initial table refresh mismatch')
          }
          if (!automatic && Math.abs(result.opticalState.dielectricState[0].values[0] - (.99 * .99 - .002 * .002)) > 1e-14) {
            throw new Error('Manual script native tensor construction mismatch')
          }
        }
      }
      const manual = createDefaultProject()
      manual.calculation.automaticOpticalConstants = false; manual.scripts.enabled = false
      manual.scripts.default = 'thickness[1] = 99\nprint("failure output")\nerror("manual failure")'
      const manualBefore = JSON.stringify(manual), failureLines = []
      let manualFailed = false
      try { await service.executeScript(manual, 'Default', lines => failureLines.push(...lines)) }
      catch (error) { manualFailed = /Default:3/.test(String(error)) }
      if (!manualFailed || failureLines[0] !== 'failure output' || JSON.stringify(manual) !== manualBefore) throw new Error('Manual failure transaction mismatch')
      manual.scripts.default = 'print("loop entered"); while true do end'
      let enteredLoop, loopTimeout
      const loopEntered = new Promise((resolve, reject) => {
        enteredLoop = resolve; loopTimeout = setTimeout(() => reject(new Error('Lua loop did not start')), 10000)
      })
      const looping = service.executeScript(manual, 'Default', lines => {
        if (lines.includes('loop entered')) enteredLoop()
      }).then(() => 'finished', error => error.name)
      try { await loopEntered } finally { clearTimeout(loopTimeout) }
      const manualStopStart = performance.now()
      service.stop()
      if (await looping !== 'ComputeCancelled') throw new Error('Manual infinite loop was not cancelled')
      if (performance.now() - manualStopStart >= 1000) throw new Error('Manual Lua Stop exceeded one second')
      manual.scripts.default = 'assert(calls == nil); thickness[1] = 17'
      const recoveredManual = await service.executeScript(manual, 'Default')
      if (recoveredManual.project.sample.layers[1].thickness !== 17) throw new Error('Manual Lua recovery failed')

      tables = []
      // Queue a genuine large WASM request, then Stop using the production service lifecycle.
      const busy = structuredClone(project)
      busy.sample.layers = Array.from({ length: 1000 }, (_, index) => createLayer({ thickness: 10, delta: index % 2 ? .001 : .002, beta: .0001 }))
      busy.experiment.qzScan.points = 100000
      busy.experiment.qzScan.qzMax = .1
      busy.datasets = [{ title: '', comment: '', sourceFile: '', energy: busy.experiment.energy, energyShift: 0,
        angularResolution: 0, intensityScale: 1, intensityOffset: 0, qzShift: 0, errorWeight: 1,
        polarization: busy.experiment.polarization, active: true,
        columns: { qz: Array.from({ length: 100000 }, (_, index) => .1 * (index + 1) / 100000), reflectivity: Array(100000).fill(1) } }]
      busy.fit.algorithm = 'simplex'; busy.fit.occamQ = 0
      busy.fit.parameters = [{ target: 'thickness', index: 1, elementIndex: null, value: 10, step: 0, lowerBound: 1, upperBound: 20 }]
      output.cancellations = []
      for (const method of ['calcReflectivity', 'calcChi2', 'startFit']) {
        let entryTimeout
        const entered = new Promise((resolve, reject) => {
          enteredResolve = resolve
          entryTimeout = setTimeout(() => reject(new Error('Real core did not start')), 10000)
        })
        const pending = service[method](busy, () => {}).then(() => 'finished', error => error.name)
        try { await entered } finally { clearTimeout(entryTimeout) }
        const start = performance.now()
        service.stop()
        const stopped = await pending
        output.restarted = await service.calcReflectivity(project)
        output.cancellations.push({ method, stopped, recoveryMilliseconds: performance.now() - start })
      }
      output.recoveryMilliseconds = Math.max(...output.cancellations.map(result => result.recoveryMilliseconds))
      return output
    } finally { service.dispose(); window.Worker = NativeWorker }
  })
  assert.ok(results.realTensorUnchanged)
  assert.equal(results.realScalarTensor.engine, 'real')
  assert.equal(results.realTensorSpectrum.source, 'table')
  assert.deepEqual(results.realTensorSpectrum.energy, [100, 150, 200])
  for (let component = 0; component < 9; component++) {
    const expected = component % 4 === 0 ? { re: .99 * .99 - .002 * .002, im: 2 * .99 * .002 } : { re: 0, im: 0 }
    for (const field of ['re', 'im']) {
      const value = results.realScalarTensor.tensors[0][component][field]
      assert.ok(Math.abs(value - expected[field]) <= 1e-15 + 1e-10 * Math.abs(expected[field]))
      assert.equal(results.realTensorSpectrum.tensors[0][component][field], value)
      const imported = (2 * component + (field === 're' ? 1 : 2)) / 100
      for (const point of [1, 2]) assert.ok(Math.abs(results.realTensorSpectrum.tensors[point][component][field] - imported) <= 1e-15 + 1e-10 * Math.abs(imported))
    }
  }
  assert.deepEqual(results.realMagneticSpectrum, { energy: [100, 150, 200], first: [9, 3, 3], second: [8, 4, 4] })
  assert.deepEqual(results.realFactors, { energy: [100, 150, 200], first: [26, 26, 26], second: [.5, .5, .5] })
  assert.ok(results.realSpectrumUnchanged)
  for (const [index, energy] of results.realElementSpectrum.energy.entries()) {
    for (const [field, factor] of [['first', 26], ['second', .5]]) {
      const expected = factor * 2 / energy / energy * .0004151761541 * 1e6
      assert.ok(Math.abs(results.realElementSpectrum[field][index] - expected) <= 1e-15 + 1e-10 * Math.abs(expected))
    }
  }
  for (const { mode, result, unchanged } of results.databaseUpdates) {
    assert.ok(unchanged)
    assert.equal(result.mode, mode)
    assert.deepEqual(result.updates, [{ index: 0, first: 1, second: 2, firstMag: 0, secondMag: 0 }])
    assert.ok(result.warnings.some(warning => warning.includes('values kept')))
    assert.ok(result.warnings.some(warning => warning.includes('magnetic values set to zero')))
  }
  assert.equal(results.fitMerges.length, 3)
  for (const result of results.fitMerges) {
    assert.ok(result.values.every(value => Math.abs(value - 2) < 1e-8), `${result.algorithm} dataset-wide fit merge`)
    assert.equal(result.updates, 2)
    assert.equal(result.active, false)
    assert.equal(result.comment, 'edited while fitting')
    assert.equal(result.selection, 0)
    assert.ok(result.unchanged)
  }
  assert.equal(results.mixedFits.length, 21)
  for (const result of results.mixedFits) {
    const label = `${result.algorithm} ${result.kind}`
    assert.ok(result.unchanged, label)
    assert.ok(result.initial > 1e-10, `${label}: insensitive synthetic fixture (${result.initial})`)
    assert.ok(Math.abs(result.value - 35) < 1e-6, `${label}: recovered ${result.value}`)
    assert.ok(result.chi2 < 1e-16, `${label}: final error ${result.chi2}`)
  }
  assert.equal(results.datasetErrors.length, 3)
  for (const result of results.realFits) {
    assert.ok(result.unchanged)
    assert.ok(Math.abs(result.value - 35) < 1e-6, `${result.algorithm} fitted thickness ${result.value}`)
    assert.ok(result.chi2 < 1e-16)
    assert.ok(new Set(result.iterations).size >= 3)
    assert.equal(result.capability, true)
    assert.deepEqual(result.previewRequests, ['fit'])
    assert.ok(result.rendered.canvases > 0)
    assert.ok(result.rendered.text.includes('fitted R'))
    assert.equal(result.preview.datasetIndex, 0)
    assert.equal(result.preview.scan, 'qz')
    assert.equal(result.preview.beams, 'monochromatic')
    assert.deepEqual(result.preview.qz, result.completedCurve.qz)
    result.preview.reflectivityPlus.forEach((value, index) => {
      const expected = result.completedCurve.reflectivity[index]
      assert.ok(Math.abs(value - expected) <= 1e-15 + 1e-10 * Math.abs(expected), `${result.algorithm} best-fit preview`)
    })
  }
  for (const result of results.datasetErrors) {
    assert.ok(result.orderedUnchanged)
    assert.ok(Math.abs(result.energyThenQz - 1) <= 1e-15 + 1e-10, `${result.algorithm} optical carry-over`)
    assert.ok(Math.abs(result.qzThenEnergy - result.reverseExpected) <= 1e-15 + 1e-10 * Math.abs(result.reverseExpected))
    assert.ok(Math.abs(result.qzThenEnergy - result.energyThenQz) > 1e-3, 'dataset ordering must exercise changed constants')
    const expected = 50.4375
    assert.ok(Math.abs(result.chi2 - expected) <= 1e-15 + 1e-10 * Math.abs(expected), `${result.algorithm} dataset error: ${result.chi2}`)
    assert.equal(result.unchanged, true)
    assert.equal(result.empty, 0)
    const first = 1 + Math.log10(2), second = 2 + Math.log10(2)
    const candidateExpected = 5 * first * first + 9 * (first * first + second * second) + 7 * .25 * .25
    assert.ok(Math.abs(result.candidate - candidateExpected) <= 1e-15 + 1e-10 * Math.abs(candidateExpected), 'Dataset-wide fit scale')
    assert.equal(result.mappingUnchanged, true)
  }
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
  results.missingRetained.reflectivity.forEach((value, index) => near(value, results.automaticBaseline.reflectivity[index]))
  assert.deepEqual(results.cancellations.map(result => [result.method, result.stopped]), [['calcReflectivity', 'ComputeCancelled'], ['calcChi2', 'ComputeCancelled'], ['startFit', 'ComputeCancelled']])
  assert.deepEqual(results.restarted, results.totalReflection)
  assert.ok(results.recoveryMilliseconds < 1000, `Stop and restart took ${results.recoveryMilliseconds} ms`)
  assert.equal(results.originalUnchanged, true)
  console.log(`Real ComputeService in Chromium: native thickness recovery for qz/energy reflectivity/asymmetry/dichroic and weighted mixed fits with automatic tables and blocked-fit Stop, weighted multi-dataset Chi² for Parratt/matrix/Zak, prepared fit-dataset settings/coordinates, imported precision 0/1/2/3 bit identity, zero contrast, total reflection, asymmetry, postprocessing, angular resolution, automatic optical tables, monochromatic/dichroic energy scans, both asymmetries, matrix qz/energy/imported tensors/multilayers/automatic tables/postprocessing, Zak qz/energy/automatic tables and tensor independence, unsupported operation and Stop/restart passed (${results.recoveryMilliseconds.toFixed(1)} ms).`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
