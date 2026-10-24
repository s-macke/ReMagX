// Verify complete parameter-to-field mapping against the production web helper.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/project_fit_tests'))
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { createDefaultProject, createDepthProfileFunction } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { fitTargetKinds, validateProject } = await server.ssrLoadModule('/src/model/project.ts')
  const { applyRealFitParameters } = await server.ssrLoadModule('/src/model/realFitParameters.ts')
  const { nativeLegacyImportDefaults } = await server.ssrLoadModule('/src/import/allFile.ts')
  const encode = value => Object.is(value, -0) ? '-0' : Number.isFinite(value) ? value : String(value)
  const encoded = values => values.map(encode)
  const serialize = value => JSON.stringify(value, (_, item) => Object.is(item, -0) ? '__negative_zero__' : item).replaceAll('"__negative_zero__"', '-0')
  const base = createDefaultProject()
  base.sample.depthProfileFunctions = [createDepthProfileFunction(), createDepthProfileFunction()]
  base.sample.elementProfiles = Array.from({ length: 2 }, () => ({ element: 'Fe', f1: 1, f2: 2, f1Mag: 3, f2Mag: 4,
    slabs: [{ thickness: 0, roughness: 0, density: 0 }, { thickness: 10, roughness: 1, density: 2 }] }))
  base.scripts.parameters = [1,2]
  base.datasets = Array.from({ length: 3 }, (_, index) => ({ ...structuredClone(nativeLegacyImportDefaults().dataset),
    active: index !== 1, angularResolution: .002, intensityScale: 3, qzShift: 2, energyShift: 1,
    columns: { qz: [.01,.02], reflectivity: [1,2] } }))
  base.activeDatasetIndex = 1 // Current dataset need not be enabled for fitting.
  base.future = { 'a/b': { '~field': 1.234 }, text: 'retained metadata' }
  const row = (target, index = 1, elementIndex = 1) => ({ target, index, elementIndex, value: 0, step: 0, lowerBound: -1000, upperBound: 1000 })
  const numericPaths = (value, path = '', result = []) => {
    if (typeof value === 'number') result.push(path)
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value))
      numericPaths(child, `${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`, result)
    return result
  }
  const read = (project, path) => path.slice(1).split('/').reduce((value, key) => value[key.replaceAll('~1','/').replaceAll('~0','~')], project)
  const inputs = [], expected = []
  const add = (project, candidates) => {
    assert.equal(validateProject(project).ok, true, 'Public test starts from a valid stored project')
    const probes = numericPaths(project)
    inputs.push({ project: serialize(project), probes, candidates: candidates.map(encoded) })
    const original = structuredClone(project)
    let current = project
    const trials = candidates.map(candidate => {
      try {
        const result = applyRealFitParameters(current, candidate)
        current = result.project
        const saveable = validateProject(current).ok
        return { ok: true, values: encoded(result.values), probes: probes.map(path => encode(read(current, path))),
          saveable, ...(saveable ? { project: current } : {}) }
      } catch { return { ok: false } }
    })
    assert.deepEqual(project, original)
    expected.push({ ok: true, trials })
  }
  for (const target of fitTargetKinds) for (const index of [null, 0, 1, 100]) {
    const project = structuredClone(base)
    project.fit.parameters = [row(target, index)]
    add(project, [[-2000], [-3], [-0], [1.25], [2000], [NaN], [], [7]])
  }
  for (const active of [null, 0, 1, 2, 100]) for (const target of ['angularResolution','intensityScale','qzShift','energyShift']) {
    const project = structuredClone(base)
    project.activeDatasetIndex = active
    project.fit.parameters = [row(target)]
    add(project, [[.004], [7]])
    project.datasets.forEach(dataset => { dataset.active = false })
    add(project, [[2]])
  }
  for (const elementIndex of [null, 0, 1, 100]) for (const target of ['elementDensity','elementThickness','elementRoughness','elementF1','elementF2','elementF1Mag','elementF2Mag']) {
    const project = structuredClone(base)
    project.sample.mode = 'element'
    project.fit.parameters = [row(target, 1, elementIndex)]
    add(project, [[5], [-5], [6]])
  }
  const duplicate = structuredClone(base)
  duplicate.fit.parameters = [row('thickness'), { ...row('thickness'), lowerBound: 4, upperBound: 4 }, row('beta')]
  add(duplicate, [[-10,999,2000], [1,2,3]])
  const invalid = structuredClone(base)
  invalid.fit.parameters = [row('thickness'), row('electronGain')]
  add(invalid, [[30,2], [1,2]])
  invalid.fit.parameters = [{ ...row('delta'), lowerBound: 2, upperBound: 1 }]
  add(invalid, [[0]])
  const missingScript = structuredClone(base)
  missingScript.scripts.parameters = []
  missingScript.fit.parameters = [row('scriptParameter', null), row('scriptParameter', 0), row('scriptParameter', 100), row('thickness')]
  add(missingScript, [[-2000,4,5,6], [1,2,3,4]])
  const all = structuredClone(base)
  all.fit.parameters = fitTargetKinds.filter(target => !['electronGain','deltaKramersKronig','betaKramersKronig'].includes(target)).map(target => row(target))
  add(all, [all.fit.parameters.map((_, index) => index + 1)])
  const empty = structuredClone(base); empty.fit.parameters = []; add(empty, [[]])
  const result = spawnSync(executable, [], { input: inputs.map(input => JSON.stringify(input)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  const actual = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => assert.deepEqual(value, expected[index], `Native fit parameter case ${index + 1}`))
  console.log(`Native/web fit parameter application: ${inputs.length} cases passed, including transient values and validated persistence.`)
} finally { await server.close() }
