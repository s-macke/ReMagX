// D-45: independently expected tensors, checked through native and actual-WASM lookup.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { lookupTable, calculateScatteringTensor } from '../../engine/wasm/parratt.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/project_dataset_tests'))
const wasm = resolve(process.argv[3] ?? resolve(root, 'build/wasm'))
const { default: createCore } = await import(pathToFileURL(resolve(wasm, 'remagx-core.mjs')))
const core = await createCore()
const server = await createServer({ root: resolve(root, 'app'), configFile: false, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { refreshElementOptics } = await server.ssrLoadModule('/src/model/refreshElementOptics.ts')
  const { parseOpticalTable } = await server.ssrLoadModule('/src/import/tables.ts')
  let cases = 0
  for (const count of [1, 2, 4]) for (const variant of ['full', 'tensor-range', 'primary-range', 'missing-neighbor', 'empty']) {
    const project = createDefaultProject()
    project.sample.mode = 'element'
    project.experiment.energy = 150
    project.calculation.automaticOpticalConstants = true
    project.calculation.segmentation.minThickness = .25
    project.calculation.magnetization.mode = 'none'
    project.calculation.tensorContribution = 'magnetic'
    const expected = [], previous = [], tables = []
    project.sample.elementProfiles = Array.from({ length: count }, (_, index) => {
      const name = `Element${index}`
      const tensor = Array.from({ length: 18 }, (_, component) => 100 * index + component + .125)
      const saved = Array(18).fill(-index - 1)
      previous.push(Float64Array.from(saved))
      const missing = variant === 'missing-neighbor' && index === count - 1
      if (!missing) tables.push({ name, kind: 'ff', text: variant === 'primary-range' ? '300 26 2\n400 26 2\n' : '100 26 2\n200 26 2\n' })
      const energies = variant === 'tensor-range' ? [300, 400] : [100, 200]
      tables.push({ name, kind: 'f', text: variant === 'empty' ? '# empty\n' : energies.map(energy => `${energy} ${tensor.join(' ')}`).join('\n') + '\n' })
      const isotropic = Array(18).fill(0)
      for (const offset of [0, 8, 16]) { isotropic[offset] = 26; isotropic[offset + 1] = 2 }
      expected.push(missing || variant === 'primary-range' ? saved : variant === 'tensor-range' ? Array(18).fill(0) : variant === 'empty' ? isotropic : tensor)
      return { element: name, f1: 7, f2: 8, f1Mag: 0, f2Mag: 0, scatteringTensor: saved, slabs: [] }
    })
    const before = JSON.stringify(project)
    const parsed = tables.map(table => parseOpticalTable(table.text, `${table.name}.${table.kind === 'f' ? 'F' : table.kind}`))
    const web = refreshElementOptics(project, parsed, 150,
      (table, energy, cursor) => lookupTable(core, table, energy, cursor),
      request => calculateScatteringTensor(core, request), new Map(), previous)
    assert.deepEqual(web.scatteringTensors.map(value => Array.from(value)), expected, `Web ${count}/${variant}`)
    const run = spawnSync(executable, [], { input: JSON.stringify({ project: before, refreshElements: true, tables }) + '\n', encoding: 'utf8', timeout: 10000 })
    assert.equal(run.status, 0, run.stderr)
    const native = JSON.parse(run.stdout)
    assert.equal(native.ok, true, `${count}/${variant}: ${run.stdout}`)
    assert.deepEqual(native.tensors, expected.flat(), `Native ${count}/${variant}`)
    assert.deepEqual(native.factors, web.elementProfiles.map(profile => [profile.f1, profile.f2, profile.f1Mag, profile.f2Mag]))
    assert.equal(native.complete, web.rangeError === null)
    assert.equal(JSON.stringify(project), before)
    cases++
  }
  console.log(`Element tensor assignment: ${cases} native/actual-WASM cases passed.`)
} finally { await server.close() }
