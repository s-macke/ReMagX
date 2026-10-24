// Native dataset curves compared with production web orchestration and actual WASM.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import * as adapter from '../../engine/wasm/parratt.mjs'
import * as segmentation from '../../engine/wasm/segmentation.mjs'
import { calculateFitError } from '../../engine/wasm/fit_error.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/project_dataset_tests'))
const wasm = resolve(process.argv[3] ?? resolve(root, 'build/wasm'))
const { default: createCore } = await import(pathToFileURL(resolve(wasm, 'remagx-core.mjs')))
const instance = await createCore()
const engine = {
  calculate: request => adapter.calculateParrattQz(instance, request),
  zakQz: request => adapter.calculateZakQz(instance, request),
  matrixQz: request => adapter.calculateVisnovskyQz(instance, request),
  dielectricTensor: request => adapter.calculateDielectricTensor(instance, request),
  scatteringTensor: request => adapter.calculateScatteringTensor(instance, request),
  lookup: (table, queries, cursor) => adapter.lookupTable(instance, table, queries, cursor),
  segmentation: {
    errorSamples: Array.from(adapter.generateErrorFunctionLookup(instance)),
    sample: request => segmentation.calculateSegmentedOptics(instance, request),
    prepareSampler: request => segmentation.createSegmentedOpticalSampler(instance, request),
    subdivide: request => segmentation.calculateAdaptiveSegments(instance, request),
    density: request => adapter.calculateLayerDensity(instance, request),
    apply: request => adapter.applyMagneticProfiles(instance, request),
  },
}
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { nativeLegacyImportDefaults } = await server.ssrLoadModule('/src/import/allFile.ts')
  const { prepareFitDataset } = await server.ssrLoadModule('/src/model/fitDataset.ts')
  const { calculateRealCurve } = await server.ssrLoadModule('/src/model/realCalculation.ts')
  const inputs = [], expected = []
  const base = createDefaultProject()
  base.scripts.enabled = false
  base.calculation.automaticOpticalConstants = false
  base.calculation.roughnessModel = 'nevot-croce'
  base.sample.multilayer.enabled = false
  base.sample.layers[1].deltaMag = 2e-6
  base.sample.layers[1].betaMag = 4e-7
  base.sample.layers[1].magnetization = { gamma: 37, phi: 63 }
  base.experiment.resolution.energyFwhm = 0
  base.calculation.averaging = 0
  base.calculation.postProcessing = { multiplyByQz4: false, divideByCos2ThetaSquared: false, fourierTransform: false }
  const add = project => {
    const original = structuredClone(project)
    const prepared = prepareFitDataset(project, 0)
    let result
    try {
      const curve = calculateRealCurve(prepared.project, [], engine, 'qz', prepared.beams)
      const asymmetry = prepared.errorMode === 2, paired = prepared.errorMode === 3, columns = prepared.measurement
      const error = calculateFitError(instance, { mode: prepared.errorMode, qz: columns.qz,
        measured: asymmetry ? columns.asymmetry : paired ? columns.reflectivityPlus : columns.reflectivity,
        calculated: asymmetry ? curve.asymmetry : curve.reflectivityPlus,
        ...(paired ? { measuredSecond: columns.reflectivityMinus, calculatedSecond: curve.reflectivityMinus } : {}), ...project.fit.window })
      result = { ok: true, qz: curve.qz, plus: curve.reflectivityPlus, minus: curve.reflectivityMinus,
        asymmetry: curve.asymmetry, mean: error.error, weighted: prepared.weight * error.error, accepted: error.accepted }
    } catch { result = { ok: false } }
    assert.deepEqual(project, original)
    inputs.push({ project: JSON.stringify(project), index: 0, calculate: true })
    expected.push(result)
  }
  for (const algorithm of ['parratt','zak','matrix']) for (const mode of ['log','linear','asymmetry','paired']) {
    for (const variant of ['plain','corrections','averaging','broadened','tiny-shift','segmented','exact','complex','broadened-corrections']) {
      const project = structuredClone(base)
      project.calculation.algorithm = algorithm
      project.fit.errorFunction = mode === 'linear' ? 'lin-chi2' : 'log-chi2'
      const columns = { qz: [.03,.08,.06,.06,.12] }
      if (mode === 'asymmetry') columns.asymmetry = [.1,.2,-.1,0,.02]
      else if (mode === 'paired') { columns.reflectivityPlus = [.3,.1,.02,.02,.001]; columns.reflectivityMinus = [.2,.08,.03,.03,.002] }
      else columns.reflectivity = [.3,.1,.02,.02,.001]
      const dataset = { ...nativeLegacyImportDefaults().dataset, columns, active: true, energy: 8000,
        angularResolution: .001, qzShift: .002, intensityScale: 1.2, intensityOffset: .0001, errorWeight: 3 }
      project.datasets = [dataset]
      project.fit.window = { qzMin: 0, qzMax: 1, energyMin: 0, energyMax: 10000 }
      if (variant === 'corrections') {
        project.calculation.postProcessing.multiplyByQz4 = true
        project.calculation.postProcessing.divideByCos2ThetaSquared = true
        dataset.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
        project.calculation.asymmetryDefinition = 'difference'
      }
      if (variant === 'averaging') project.calculation.averaging = 1
      if (variant === 'broadened') { project.experiment.resolution.energyFwhm = 3; project.calculation.averaging = 1 }
      if (variant === 'exact') project.experiment.resolution.fastConvolution = false
      if (variant === 'complex') {
        dataset.polarization.beam1 = { sigma: { re: .6, im: .2 }, pi: { re: -.4, im: .5 } }
        dataset.polarization.beam2 = { sigma: { re: .3, im: -.2 }, pi: { re: .6, im: .1 } }
        dataset.polarization.analyzer = 'pi'
      }
      if (variant === 'broadened-corrections') {
        project.experiment.resolution.energyFwhm = 3
        project.calculation.postProcessing.multiplyByQz4 = true
        project.calculation.postProcessing.divideByCos2ThetaSquared = true
        dataset.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
      }
      if (variant === 'tiny-shift') dataset.qzShift = 1e-10
      if (variant === 'segmented') project.calculation.roughnessModel = 'segmentation'
      add(project)
    }
  }
  const unavailable = ['script', 'energy'].map(kind => {
    const project = JSON.parse(inputs[0].project)
    if (kind === 'script') { project.scripts.enabled = true; project.scripts.beforeCalculation = 'print(1)' }
    else project.datasets[0].columns.energy = project.datasets[0].columns.qz.map(() => 8000)
    return { project: JSON.stringify(project), index: 0, calculate: true }
  })
  // Follow unsupported requests with a valid request in the same native process.
  const requests = [...inputs, ...unavailable, inputs[0]]
  const run = spawnSync(executable, [], { input: requests.map(value => JSON.stringify(value)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 })
  assert.equal(run.status, 0, run.stderr || String(run.error))
  const actual = run.stdout.trimEnd().split('\n').map(line => JSON.parse(line).calculation)
  assert.equal(actual.length, expected.length + 3)
  assert.deepEqual(actual.slice(expected.length, expected.length + 2), [{ ok: false }, { ok: false }])
  assert.deepEqual(actual.at(-1), actual[0], 'Valid calculation recovers after unsupported requests')
  let successes = 0
  for (let index = 0; index < expected.length; index++) {
    const current = actual[index], reference = expected[index], label = `Fit curve case ${index + 1}`
    assert.equal(current?.ok, reference.ok, label)
    if (!reference.ok) continue
    successes++
    assert.deepEqual(current.qz, reference.qz, `${label} coordinates`)
    assert.equal(current.accepted, reference.accepted, `${label} accepted points`)
    for (const key of ['plus','minus','asymmetry','mean','weighted']) {
      const values = Array.isArray(reference[key]) ? reference[key] : [reference[key]]
      const results = Array.isArray(current[key]) ? current[key] : [current[key]]
      assert.equal(results.length, values.length, label)
      values.forEach((value, point) => assert.ok(Math.abs(results[point] - value) <= 1e-15 + 1e-10 * Math.abs(value), `${label}/${key}/${point}: ${results[point]} vs ${value}`))
    }
  }
  assert.equal(successes, inputs.length, 'All public curve fixtures must calculate successfully')
  console.log(`Native fit curves and errors: ${successes} actual-WASM comparisons passed.`)
} finally { await server.close() }
