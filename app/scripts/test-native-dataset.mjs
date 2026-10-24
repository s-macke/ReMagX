// Public measured-column preparation and shared native/WASM error integration.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { calculateFitError } from '../../engine/wasm/fit_error.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/project_dataset_tests'))
const wasm = resolve(process.argv[3] ?? resolve(root, 'build/wasm'))
const { default: createCore } = await import(pathToFileURL(resolve(wasm, 'remagx-core.mjs')))
const instance = await createCore()
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { createDefaultProject, createDepthProfileFunction } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { nativeLegacyImportDefaults } = await server.ssrLoadModule('/src/import/allFile.ts')
  const { prepareFitDataset } = await server.ssrLoadModule('/src/model/fitDataset.ts')
  const { validateProject } = await server.ssrLoadModule('/src/model/project.ts')
  const serialize = value => JSON.stringify(value, (_, item) => Object.is(item, -0) ? '__negative_zero__' : item).replaceAll('"__negative_zero__"', '-0')
  const base = createDefaultProject()
  base.calculation.averaging = 0
  base.calculation.postProcessing = { multiplyByQz4: false, divideByCos2ThetaSquared: false, fourierTransform: false }
  base.sample.depthProfileFunctions = [createDepthProfileFunction()]
  const dataset = { ...nativeLegacyImportDefaults().dataset, energy: 8000, angularResolution: .002,
    active: true, intensityOffset: .01, intensityScale: 2, qzShift: .001, energyShift: 3, errorWeight: 4,
    columns: { qz: [.2,-.1,.1,.1,-0], reflectivity: [1,0,-1,.2,1e-8], electronYield: [1,2,3,4,5] } }
  base.datasets = [structuredClone(dataset), structuredClone(dataset)]
  base.activeDatasetIndex = null
  base.fit.window = { qzMin: 0, qzMax: .201, energyMin: 7900, energyMax: 8100 }
  const inputs = [], expected = []
  const add = (project, index = 1, edits = [], alterCurve = () => {}) => {
    const original = structuredClone(project)
    const request = { project: serialize(project), index, edits }
    const current = structuredClone(project)
    for (const [path, value] of edits) {
      const parts = path.slice(1).split('/').map(key => key.replaceAll('~1','/').replaceAll('~0','~'))
      let owner = current
      for (const part of parts.slice(0,-1)) owner = owner[part]
      owner[parts.at(-1)] = value
    }
    try {
      const prepared = prepareFitDataset(current, index)
      const columns = Object.fromEntries(Object.entries(prepared.measurement).filter(([, value]) => value !== undefined))
      const saveable = validateProject(prepared.project).ok
      const record = { ok: true, measurement: columns, errorMode: prepared.errorMode, scan: prepared.scan,
        beams: prepared.beams, weight: prepared.weight, context: { energy: prepared.project.experiment.energy,
          angularFwhm: prepared.project.experiment.resolution.angularFwhm,
          activeDatasetIndex: prepared.project.activeDatasetIndex, useDatasetPoints: prepared.project.experiment.qzScan.useDatasetPoints },
        saveable, ...(saveable ? { project: prepared.project } : {}) }
      const curve = { qz: [...columns.qz], ...(columns.energy ? { energy: [...columns.energy] } : {}),
        plus: (columns.reflectivity ?? columns.reflectivityPlus ?? columns.qz.map(() => 1)).map(value => value * .95),
        minus: (columns.reflectivityMinus ?? columns.qz.map(() => 1)).map(value => value * 1.05),
        asymmetry: (columns.asymmetry ?? columns.qz.map(() => 0)).map(value => value * .9 + .01) }
      alterCurve(curve)
      request.curve = Object.fromEntries(Object.entries(curve).map(([key, values]) => [key, values.map(value => Number.isNaN(value) ? 'NaN' : value)]))
      try {
        if (curve.qz.length !== columns.qz.length || curve.qz.some((value, point) => value !== columns.qz[point])) throw new Error('Coordinates differ')
        if (prepared.scan === 'energy' && (curve.energy.length !== columns.energy.length || curve.energy.some((value, point) => value !== columns.energy[point]))) throw new Error('Energies differ')
        const asymmetry = [2,6].includes(prepared.errorMode), paired = [3,7].includes(prepared.errorMode)
        const result = calculateFitError(instance, { mode: prepared.errorMode, qz: columns.qz, energy: columns.energy,
          measured: asymmetry ? columns.asymmetry : paired ? columns.reflectivityPlus : columns.reflectivity,
          calculated: asymmetry ? curve.asymmetry : curve.plus,
          ...(paired ? { measuredSecond: columns.reflectivityMinus, calculatedSecond: curve.minus } : {}), ...project.fit.window })
        const weighted = prepared.weight * result.error
        if (!Number.isFinite(weighted)) throw new Error('Weighted error overflows')
        record.error = { ok: true, mean: result.error, weighted, accepted: result.accepted }
      } catch { record.error = { ok: false } }
      expected.push(record)
    } catch { expected.push({ ok: false }) }
    assert.deepEqual(project, original)
    inputs.push(request)
  }
  for (const kind of ['reflectivity','asymmetry','paired','all','asymmetry-paired']) for (const energy of [false,true]) {
    for (const linear of [false,true]) for (const variant of ['plain','combined','wide-average','tiny-shift']) {
      const project = structuredClone(base), current = project.datasets[1]
      project.fit.errorFunction = linear ? 'lin-chi2' : 'log-chi2'
      if (kind !== 'reflectivity' && kind !== 'all') delete current.columns.reflectivity
      if (kind.includes('asymmetry') || kind === 'all') current.columns.asymmetry = [-.5,.2,0,1,-1]
      if (kind.includes('paired') || kind === 'all') {
        current.columns.reflectivityPlus = [1,0,-.02,.2,1e-8]
        current.columns.reflectivityMinus = [.5,0,0,.1,2e-8]
      }
      if (energy) current.columns.energy = [8000,9000,7000,8000,8050]
      if (variant === 'combined') {
        project.calculation.postProcessing.multiplyByQz4 = true
        project.calculation.postProcessing.divideByCos2ThetaSquared = true
        current.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
        project.calculation.averaging = 1
        project.calculation.asymmetryDefinition = 'difference'
      }
      if (variant === 'wide-average') project.calculation.averaging = 3
      if (variant === 'tiny-shift') { current.qzShift = 1e-10; current.energyShift = -1e-10 }
      add(project)
    }
  }
  for (const shift of [-1.0000000000000002e-10, -1e-10, 0, 1e-10, 1.0000000000000002e-10]) {
    const project = structuredClone(base)
    project.datasets[1].qzShift = shift; project.datasets[1].energyShift = shift
    project.datasets[1].columns.energy = [8000,8000,8000,8000,8000]
    add(project)
  }
  for (const weight of [0,-2,Number.MAX_VALUE]) {
    const project = structuredClone(base); project.datasets[1].errorWeight = weight
    add(project)
    add(project, 1, [], curve => { curve.plus[0] = NaN })
  }
  add(base, 1, [], curve => { curve.qz[0] += 1e-12 })
  add(base, 1, [], curve => { curve.plus.pop() })
  const energyMismatch = structuredClone(base)
  energyMismatch.datasets[1].columns.energy = [8000,8000,8000,8000,8000]
  add(energyMismatch, 1, [], curve => { curve.energy[0] += 1 })
  const inverted = structuredClone(base); inverted.fit.window.qzMin = 100; add(inverted)
  const unknown = structuredClone(base)
  unknown.datasets[1].columns.future = [9]
  unknown.datasets[1].polarization.future = 'metadata'
  add(unknown)
  for (const edits of [
    [['/datasets/1/angularResolution', -1]], [['/sample/depthProfileFunctions/0/width', -2]],
    [['/datasets/1/intensityScale', Number.MAX_VALUE]], [['/calculation/averaging', -1]],
    [['/calculation/averaging', .5]], [['/calculation/averaging', 2147483648]],
    [['/datasets/1/energy', 0]], [['/datasets/1/energy', -1]],
  ]) add(base, 1, edits)
  for (const index of [-1,.5,3]) add(base, index)
  const fourier = structuredClone(base); fourier.calculation.postProcessing.fourierTransform = true; add(fourier)
  const unsupported = structuredClone(base); delete unsupported.datasets[1].columns.reflectivity; add(unsupported)
  unsupported.datasets[1].columns = { qz: [] }; add(unsupported)
  const result = spawnSync(executable, [], { input: inputs.map(input => JSON.stringify(input)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  const actual = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.equal(actual.length, expected.length)
  const compare = (actual, expected, path) => {
    if (typeof expected === 'number') {
      assert.equal(typeof actual, 'number', path)
      if (/\/measurement\/(reflectivity|reflectivityPlus|reflectivityMinus|asymmetry|electronYield)\//.test(path) || /\/error\/(mean|weighted)$/.test(path))
        assert.ok(Math.abs(actual - expected) <= 1e-15 + 1e-10 * Math.abs(expected), path)
      else assert.equal(actual, expected, path)
    } else if (expected && typeof expected === 'object') {
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path)
      for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}/${key}`)
    } else assert.equal(actual, expected, path)
  }
  actual.forEach((value, index) => compare(value, expected[index], `Dataset case ${index + 1}`))
  console.log(`Native/web dataset preparation and actual-WASM error comparison: ${inputs.length} cases passed.`)
} finally { await server.close() }
