// Focused standalone initialization and fixed-parameter fit checks.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import * as adapter from '../../engine/wasm/parratt.mjs'
import { calculateFitError } from '../../engine/wasm/fit_error.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/project_dataset_tests'))
const { default: createCore } = await import(pathToFileURL(resolve(process.argv[3] ?? resolve(root, 'build/wasm'), 'remagx-core.mjs')))
const instance = await createCore()
const engine = {
  calculate: request => adapter.calculateParrattQz(instance, request),
  zakQz: request => adapter.calculateZakQz(instance, request),
  matrixQz: request => adapter.calculateVisnovskyQz(instance, request),
  energyScan: request => adapter.calculateParrattEnergyScan(instance, request),
  zakEnergy: request => adapter.calculateZakEnergyScan(instance, request),
  matrixEnergy: request => adapter.calculateVisnovskyEnergyScan(instance, request),
  dielectricTensor: request => adapter.calculateDielectricTensor(instance, request),
  scatteringTensor: request => adapter.calculateScatteringTensor(instance, request),
  lookup: (table, queries, cursor) => adapter.lookupTable(instance, table, queries, cursor),
  fitError: request => calculateFitError(instance, request),
  elementPreparation: { errorSamples: Array.from(adapter.generateErrorFunctionLookup(instance)),
    density: request => adapter.calculateElementDensity(instance, request),
    optics: request => adapter.calculateElementOptics(instance, request) },
}
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { nativeLegacyImportDefaults } = await server.ssrLoadModule('/src/import/allFile.ts')
  const { parseOpticalTable } = await server.ssrLoadModule('/src/import/tables.ts')
  const { prepareStandaloneFit } = await server.ssrLoadModule('/src/model/standaloneFit.ts')
  const { runRealFit } = await server.ssrLoadModule('/src/model/realFit.ts')
  const inputs = [], expected = []
  const add = (project, tables, succeeds) => {
    const original = structuredClone(project)
    const reference = project.fit.parameters.map(parameter => parameter.value)
    let result
    try {
      const parsed = tables.map(table => parseOpticalTable(table.text, `${table.name}.${table.kind}`))
      const prepared = prepareStandaloneFit(project, parsed, engine)
      const fitted = runRealFit(prepared.project, parsed, engine, () => { throw new Error('Fixed fit must not invoke optimizer') },
        () => {}, () => false, undefined, prepared.opticalState)
      result = { results: [{ ok: true, project: fitted.project, values: fitted.values,
        reference, error: fitted.chi2 }] }
    } catch { result = { ok: false } }
    assert.equal(!!result.results, succeeds, `Fit-start fixture ${inputs.length + 1}`)
    assert.deepEqual(project, original)
    expected.push(JSON.parse(JSON.stringify(result)))
    inputs.push({ project: JSON.stringify(project), tables, prepareFit: true,
      candidates: [{ values: reference, reference }] })
  }
  for (const algorithm of ['parratt','zak','matrix']) for (const element of [false,true]) {
    for (const automatic of [false,true]) for (const energy of [false,true]) {
      const project = createDefaultProject()
      project.experiment.energy = 8000; project.experiment.resolution.energyFwhm = 0
      project.calculation.algorithm = algorithm; project.calculation.roughnessModel = 'nevot-croce'
      project.calculation.automaticOpticalConstants = automatic; project.calculation.averaging = 0
      project.calculation.postProcessing = { multiplyByQz4: false, divideByCos2ThetaSquared: false, fourierTransform: false }
      project.sample.multilayer.enabled = false; project.scripts.enabled = false
      project.sample.layers[1].deltaMag = 2e-6; project.sample.layers[1].betaMag = 1e-7
      project.sample.layers[1].magnetization = { gamma: 37, phi: 63 }
      project.sample.mode = element ? 'element' : 'compound'
      project.sample.elementProfiles = [{ element: 'Fe', f1: 25, f2: 2, f1Mag: .4, f2Mag: .1,
        slabs: [{ thickness: 900, density: .08, roughness: 3 }, { thickness: 27, density: .09, roughness: 2 }, { thickness: 800, density: 0, roughness: 7 }] }]
      project.calculation.segmentation.minThickness = .5
      project.calculation.segmentation.tolerance = 1e-9
      project.fit.parameters = [{ target: element ? 'elementThickness' : 'thickness', index: 1, elementIndex: 0,
        value: 27, step: 1, lowerBound: 27, upperBound: 27 }]
      const opticalValue = element ? 28 : 3e-5
      project.fit.parameters.push({ target: element ? 'elementF1' : 'delta', index: element ? 0 : 1, elementIndex: 0,
        value: opticalValue, step: 1, lowerBound: opticalValue, upperBound: opticalValue })
      project.datasets = [{ ...nativeLegacyImportDefaults().dataset, active: true, energy: 8000, angularResolution: .001,
        columns: { qz: [.03,.06,.09], reflectivity: [.3,.02,.001], ...(energy ? { energy: [7900,8000,8100] } : {}) } }]
      project.activeDatasetIndex = 0
      project.fit.window = { qzMin: 0, qzMax: 1, energyMin: 0, energyMax: 10000 }
      const tables = [{ name: 'Fe', kind: 'ff', text: '7800 25 2\n8300 26 3\n' }]
      project.sample.layers.forEach((layer, index) => {
        layer.opticalTable = `public-${index}`
        const factor = index === project.sample.layers.length - 1 ? 0 : index + 1
        tables.push({ name: layer.opticalTable, kind: 'db', text: `7800 ${factor * 1e-5} ${factor * 1e-7}\n8300 ${factor * 2e-5} ${factor * 2e-7}\n` })
      })
      add(project, tables, true)
      if (algorithm === 'parratt' && automatic && energy) {
        add(project, [], false)
        const range = structuredClone(project); range.experiment.energy = 9000; add(range, tables, false)
        const inactive = structuredClone(project); inactive.datasets[0].active = false; add(inactive, tables, false)
        const empty = structuredClone(project); empty.datasets[0].columns = { qz: [], reflectivity: [] }; add(empty, tables, false)
      }
    }
  }
  const run = spawnSync(executable, [], { input: inputs.map(value => JSON.stringify(value)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 })
  assert.equal(run.status, 0, run.stderr || String(run.error))
  const actual = run.stdout.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.equal(actual.length, expected.length)
  const compare = (actual, expected, path) => {
    if (typeof expected === 'number') {
      assert.equal(typeof actual, 'number', path)
      assert.ok(Math.abs(actual - expected) <= 1e-15 + 1e-10 * Math.abs(expected), `${path}: ${actual} vs ${expected}`)
    } else if (expected && typeof expected === 'object') {
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path)
      for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}/${key}`)
    } else assert.equal(actual, expected, path)
  }
  actual.forEach((value, index) => compare(value, expected[index], `Fit-start case ${index + 1}`))
  console.log(`Native standalone fit initialization: ${inputs.length} actual-WASM cases passed.`)
} finally { await server.close() }
