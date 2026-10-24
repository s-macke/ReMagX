// Focused standalone initialization and fixed-parameter fit checks.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import * as adapter from '../../engine/wasm/parratt.mjs'
import { minimizeAdaptiveSimplex, minimizeAnnealing } from '../../engine/wasm/optimizer.mjs'
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
  const { createBeforeCalculation } = await server.ssrLoadModule('/src/compute/lua/beforeCalculation.ts')
  const { createLuaRuntime } = await server.ssrLoadModule('/src/compute/lua/runtime.ts')
  const runtime = createLuaRuntime(resolve(root, 'app/node_modules/wasmoon/dist/glue.wasm'))
  const inputs = [], expected = [], runnerFixtures = []
  const add = async (project, tables, succeeds) => {
    const session = project.scripts.enabled ? await runtime.createSession() : undefined
    const original = structuredClone(project)
    const reference = project.fit.parameters.map(parameter => parameter.value)
    let result
    try {
      const parsed = tables.map(table => parseOpticalTable(table.text, `${table.name}.${table.kind}`))
      const prepared = prepareStandaloneFit(project, parsed, engine)
      const fitted = runRealFit(prepared.project, parsed, engine, () => { throw new Error('Fixed fit must not invoke optimizer') },
        () => {}, () => false, session ? createBeforeCalculation(session, engine, parsed) : undefined, prepared.opticalState)
      result = { results: [{ ok: true, project: fitted.project, values: fitted.values,
        reference, error: fitted.chi2 }] }
    } catch { result = { ok: false } } finally { session?.close() }
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
      await add(project, tables, true)
      if (!element && !automatic && !energy) runnerFixtures.push({ project, tables })
      {
        const scripted = structuredClone(project)
        scripted.scripts.enabled = true
        scripted.scripts.parameters = [0]
        scripted.scripts.beforeCalculation = `calls=(calls or 0)+1
renewals=(renewals or 0)+renewocs
if calls==1 then alias=thickness; print('fit-script') end
alias[1]=alias[1]+calls*0.00001
par[0]=par[0]+0.001
SetChemicalFormula(1,tostring(calls)..":"..tostring(renewals))
${element ? 'Fe:setdensity(1,0.1+calls*0.0001)' : 'delta[1]=delta[1]+calls*1e-12'}
FillTensors()
${energy ? 'energy=energy+0.05; resolution=0.001+calls*1e-8' : ''}`
        scripted.datasets.push({ ...structuredClone(scripted.datasets[0]), energy: 8050 })
        if (energy) delete scripted.datasets[1].columns.energy
        await add(scripted,tables,true)
        scripted.experiment.resolution.energyFwhm = 1
        await add(scripted,tables,true)
        if (!energy && !element && !automatic) runnerFixtures.push({ project:scripted,tables })
        if (energy) {
          const skipped = structuredClone(scripted)
          for (const dataset of skipped.datasets) dataset.columns.energy = [7700,8000,9000]
          await add(skipped,tables,true)
          const paired = structuredClone(scripted)
          for (const dataset of paired.datasets) {
            dataset.columns.reflectivityPlus = dataset.columns.reflectivity
            dataset.columns.reflectivityMinus = [.2,.01,.0005]
            delete dataset.columns.reflectivity
          }
          await add(paired,tables,true)
        }
      }
      if (algorithm === 'parratt' && automatic && energy) {
        await add(project, [], false)
        const range = structuredClone(project); range.experiment.energy = 9000; await add(range, tables, false)
        const inactive = structuredClone(project); inactive.datasets[0].active = false; await add(inactive, tables, false)
        const empty = structuredClone(project); empty.datasets[0].columns = { qz: [], reflectivity: [] }; await add(empty, tables, false)
      }
    }
  }
  for (const fixture of runnerFixtures) for (const algorithm of ['simplex','simplex-annealing']) for (const weight of [0,.03]) {
    const project = structuredClone(fixture.project)
    project.fit.algorithm = algorithm; project.fit.occamQ = weight
    project.fit.parameters[0].lowerBound = 1; project.fit.parameters[0].upperBound = 200
    project.fit.annealing = { temperature: .01, temperatureStep: -.001 }
    project.fit.evolution.randomSeed = -1
    const settings = { maxEvaluations: 80, maxIterations: 40 }
    const tables = fixture.tables.map(table => parseOpticalTable(table.text, `${table.name}.${table.kind}`))
    const prepared = prepareStandaloneFit(project, tables, engine)
    let summary
    const session = project.scripts.enabled ? await runtime.createSession() : undefined
    const fitted = runRealFit(prepared.project, tables, engine, request => {
      summary = request.annealing ? minimizeAnnealing(instance, { ...request, ...request.annealing, ...settings })
        : minimizeAdaptiveSimplex(instance, { ...request, ...settings })
      return summary
    }, () => {}, () => false, session ? createBeforeCalculation(session, engine, tables) : undefined, prepared.opticalState)
    session?.close()
    expected.push(JSON.parse(JSON.stringify({ ok: true, project: fitted.project, values: fitted.values,
      reference: fitted.regularizationReference ?? project.fit.parameters.map(parameter => parameter.value), error: fitted.chi2,
      iterations: fitted.iterations, evaluations: summary.evaluations,
      termination: ['converged','evaluation-limit','iteration-limit','stopped'].indexOf(summary.termination) })))
    inputs.push({ project: JSON.stringify(project), tables: fixture.tables, runFit: settings })
  }
  const validRunner = inputs.at(-1)
  inputs.push({ ...validRunner, runFit: { stop: true } }, { ...validRunner, runFit: { maxEvaluations: 1 } }, validRunner)
  const validExpected = expected.at(-1)
  expected.push({ ok: false }, { ok: false }, validExpected)
  const run = spawnSync(executable, [], { input: inputs.map(value => JSON.stringify(value)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 })
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
  const terminal = resolve(dirname(executable), 'remagx-terminal')
  const directory = await mkdtemp(resolve(tmpdir(), 'remagx-fit-cli-'))
  try {
    const filename = resolve(directory, 'project.json')
    // Manual energy fitting still needs tables for the strict initial refresh.
    const plainQz = inputs.findIndex(value => { const p=JSON.parse(value.project); return !p.scripts.enabled && !p.datasets[0].columns.energy })
    const plainEnergy = inputs.findIndex(value => { const p=JSON.parse(value.project); return !p.scripts.enabled && p.datasets[0].columns.energy?.length })
    await writeFile(filename, inputs[plainEnergy].project)
    const missing = spawnSync(terminal, ['-fit', filename], { cwd: directory, encoding: 'utf8', timeout: 30000 })
    assert.equal(missing.status, 1); assert.equal(missing.stdout, '')
    const scriptedQz = inputs.findIndex(value => JSON.parse(value.project).scripts.enabled)
    const scriptedEnergy = inputs.findIndex(value => { const p=JSON.parse(value.project); return p.scripts.enabled && p.datasets[0].columns.energy?.length })
    for (const index of [plainQz,plainEnergy,scriptedQz,scriptedEnergy]) {
      const request = inputs[index]
      await writeFile(filename, request.project)
      for (const table of request.tables) await writeFile(resolve(directory, `${table.name}.${table.kind}`), table.text)
      const output = spawnSync(terminal, ['-fit', filename], { cwd: directory, encoding: 'utf8', timeout: 30000 })
      assert.equal(output.status, 0, output.stderr || String(output.error))
      assert.match(output.stderr, /Fit error:/)
      if (index === scriptedQz || index === scriptedEnergy) assert.match(output.stderr, /fit-script/)
      compare(JSON.parse(output.stdout), expected[index].results[0].project, `CLI fitted project ${index}`)
      assert.equal(await readFile(filename, 'utf8'), request.project, 'CLI fit changed its input')
    }
    const rejected = JSON.parse(inputs[scriptedQz].project)
    rejected.scripts.beforeCalculation = "print('fit-script'); error('public fit failure')"
    await writeFile(filename,JSON.stringify(rejected))
    const failure = spawnSync(terminal,['-fit',filename],{cwd:directory,encoding:'utf8',timeout:30000})
    assert.equal(failure.status,1); assert.equal(failure.stdout,'')
    assert.match(failure.stderr,/Lua execution failed: BeforeCalculation:1: public fit failure/)
  } finally { await rm(directory, { recursive: true, force: true }) }
  console.log('Native -fit CLI: qz/energy JSON output, input preservation and missing-table failure passed.')
  console.log(`Native fit start and optimizer integration: ${inputs.length} actual-WASM cases passed.`)
} finally { await server.close() }
