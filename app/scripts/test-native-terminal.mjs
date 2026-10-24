// Public synthetic projects only. The production web preparation and actual WASM
// core provide the reference; terminal coordinates follow the original CLI.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import * as adapter from '../../engine/wasm/parratt.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/remagx-terminal'))
const wasm = resolve(process.argv[3] ?? resolve(root, 'build/wasm'))
const { default: createCore } = await import(pathToFileURL(resolve(wasm, 'remagx-core.mjs')))
const instance = await createCore()
const engine = {
  calculate: request => adapter.calculateParrattQz(instance, request),
  zakQz: request => adapter.calculateZakQz(instance, request),
  matrixQz: request => adapter.calculateVisnovskyQz(instance, request),
  dielectricTensor: request => adapter.calculateDielectricTensor(instance, request),
}
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true }, appType: 'custom' })
const directory = await mkdtemp(resolve(tmpdir(), 'remagx-native-terminal-'))
try {
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { calculateRealCurve } = await server.ssrLoadModule('/src/model/realCalculation.ts')
  const { importAllFile } = await server.ssrLoadModule('/src/import/allFile.ts')
  const imported = importAllFile(await readFile(resolve(root, 'app/test/fixtures/Tut2.all'), 'utf8'), 'Tut2.all').project
  const dataset = imported.datasets[0]
  assert.ok(dataset)
  const base = createDefaultProject()
  base.calculation.automaticOpticalConstants = false
  base.calculation.roughnessModel = 'nevot-croce'
  base.calculation.postProcessing = { multiplyByQz4: false, divideByCos2ThetaSquared: false, fourierTransform: false }
  base.calculation.averaging = 0
  base.sample.multilayer.enabled = false
  base.scripts.enabled = false
  base.experiment.qzScan = { qzMin: 0.05, qzMax: 0.2, points: 13, useDatasetPoints: false, showAngle: false }
  base.experiment.resolution.energyFwhm = 0
  base.sample.layers[1].deltaMag = 2e-6
  base.sample.layers[1].betaMag = 4e-7
  base.sample.layers[1].magnetization = { gamma: 37, phi: 63 }
  const filename = resolve(directory, 'public-synthetic.json')
  let comparisons = 0, values = 0
  function run(args) {
    return spawnSync(executable, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10000 })
  }
  async function compare(project, dichroic) {
    const text = JSON.stringify(project)
    await writeFile(filename, text)
    const actual = run([dichroic ? '-dicrefl' : '-refl', filename])
    assert.equal(actual.status, 0, actual.stderr || String(actual.error))
    assert.equal(actual.stderr, '')
    assert.equal(await readFile(filename, 'utf8'), text, 'Calculation changed its input')
    const qz = project.experiment.qzScan.useDatasetPoints
      ? project.datasets[project.activeDatasetIndex].columns.qz.map(value => value + project.datasets[project.activeDatasetIndex].qzShift)
      : Array.from({ length: project.experiment.qzScan.points }, (_, index) => index / (project.experiment.qzScan.points - 1) * project.experiment.qzScan.qzMax)
    // Supply the terminal's measured coordinates to the real web preparation.
    const reference = structuredClone(project)
    reference.datasets = [{ ...structuredClone(dataset), qzShift: 0, energyShift: 0, columns: { qz } }]
    reference.activeDatasetIndex = 0
    reference.experiment.qzScan.useDatasetPoints = true
    const expected = calculateRealCurve(reference, [], engine, 'qz', dichroic ? 'dichroic' : 'monochromatic')
    const rows = actual.stdout.trim().split('\n').map(line => line.split(/\s+/).map(Number))
    assert.equal(rows.length, qz.length)
    rows.forEach((row, index) => {
      assert.equal(row.length, dichroic ? 3 : 2)
      assert.equal(row[0], qz[index], 'Coordinate round trip differs')
      const wanted = [expected.reflectivityPlus[index], expected.reflectivityMinus[index]]
      row.slice(1).forEach((value, column) => {
        assert.ok(Number.isFinite(value))
        assert.ok(Math.abs(value - wanted[column]) <= 1e-15 + 1e-10 * Math.abs(wanted[column]),
          `Native/WASM terminal difference at case ${comparisons}, point ${index}, column ${column}`)
        values++
      })
    })
    comparisons++
  }
  for (const algorithm of ['parratt', 'matrix', 'zak']) {
    for (const dichroic of [false, true]) {
      for (const fast of [false, true]) {
        for (const analyzer of ['none', 'sigma', 'pi']) {
          const project = structuredClone(base)
          project.calculation.algorithm = algorithm
          project.experiment.resolution.fastConvolution = fast
          project.experiment.resolution.angularFwhm = fast ? 0.001 : 0.0005
          project.experiment.polarization.analyzer = analyzer
          project.experiment.polarization.beam1 = { sigma: { re: 0.6, im: 0.2 }, pi: { re: -0.1, im: 0.7 } }
          project.experiment.polarization.beam2 = { sigma: { re: 0.3, im: -0.4 }, pi: { re: 0.5, im: 0.1 } }
          await compare(project, dichroic)
        }
      }
      const processed = structuredClone(base)
      processed.calculation.algorithm = algorithm
      processed.calculation.postProcessing.multiplyByQz4 = true
      processed.calculation.averaging = 2
      processed.calculation.tensorContribution = 'tetragonal'
      processed.calculation.magnetization.mode = 'none'
      processed.datasets = [{ ...structuredClone(dataset), qzShift: 0, columns: { qz: [0.01, 0.03, 0.06, 0.1, 0.2] } }]
      processed.activeDatasetIndex = 0
      processed.experiment.qzScan.useDatasetPoints = true
      await compare(processed, dichroic)
      const measured = structuredClone(base)
      measured.calculation.algorithm = algorithm
      measured.datasets = [{ ...structuredClone(dataset), qzShift: 5e-12, columns: { qz: [0.03, -0.01, 0.03, 0.01, 0.2] } }]
      measured.activeDatasetIndex = 0
      measured.experiment.qzScan.useDatasetPoints = true
      await compare(measured, dichroic)
      for (const pattern of ['3*(1)', '2*(1,2*(1))', '', '0*(1),1', '0,1,2', '1\0,2', '1)2', '1a']) {
        const multilayer = structuredClone(base)
        multilayer.calculation.algorithm = algorithm
        multilayer.sample.multilayer = { enabled: true, pattern }
        await compare(multilayer, dichroic)
      }
    }
  }
  // At zero incidence the existing tetragonal/magnetization-off kernel can
  // reject a numerical singularity. Preserve and verify that failure, not a
  // fabricated zero intensity or an altered coordinate grid.
  let singularities = 0
  for (const algorithm of ['parratt', 'matrix', 'zak']) {
    const project = structuredClone(base)
    project.calculation.algorithm = algorithm
    project.calculation.tensorContribution = 'tetragonal'
    project.calculation.magnetization.mode = 'none'
    await writeFile(filename, JSON.stringify(project))
    const actual = run(['-refl', filename])
    const reference = structuredClone(project)
    reference.datasets = [{ ...structuredClone(dataset), qzShift: 0, columns: {
      qz: Array.from({ length: 13 }, (_, index) => index / 12 * 0.2),
    } }]
    reference.activeDatasetIndex = 0
    reference.experiment.qzScan.useDatasetPoints = true
    let failure
    try { calculateRealCurve(reference, [], engine, 'qz', 'monochromatic') } catch (error) { failure = error }
    if (failure) {
      assert.equal(failure.status, 2, 'Only the observed native numerical status is expected')
      assert.equal(actual.status, 1)
      assert.equal(actual.stdout, '')
      assert.match(actual.stderr, /Numerical calculation failed/)
      singularities++
    } else assert.equal(actual.status, 0)
  }
  assert.ok(singularities > 0, 'The observed zero-incidence singularity must remain covered')
  const invalid = [
    project => { project.calculation.automaticOpticalConstants = true },
    project => { project.sample.mode = 'element' },
    project => { project.sample.multilayer = { enabled: true, pattern: '2*(1' } },
    project => { project.sample.multilayer = { enabled: true, pattern: '100000*(1)' } },
    project => { project.sample.multilayer = { enabled: true, pattern: '0*(999)' } },
    project => { project.calculation.roughnessModel = 'segmentation' },
    project => { project.scripts.enabled = true; project.scripts.beforeCalculation = 'error("private diagnostic")' },
    project => { project.experiment.scattering = 'transmission' },
    project => { project.calculation.postProcessing.divideByCos2ThetaSquared = true },
    project => { project.calculation.postProcessing.fourierTransform = true },
    project => { project.experiment.resolution.energyFwhm = 1 },
    project => { project.experiment.qzScan.points = 1000001 },
    project => { project.experiment.qzScan.qzMax = 1e100 },
    project => { project.sample.layers[1].beta = 1e200 },
    project => { project.experiment.qzScan.useDatasetPoints = true; project.activeDatasetIndex = null },
    project => { project.sample.layers[0].thickness = -1 },
  ]
  for (const mutate of invalid) {
    const project = structuredClone(base); mutate(project)
    await writeFile(filename, JSON.stringify(project))
    const result = run(['-refl', filename])
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '', 'Failure emitted partial scientific output')
    assert.ok(result.stderr.length > 0)
    assert.ok(!result.stderr.includes('private diagnostic'))
  }
  for (const command of ['-fit', '-convert', '-map', '--unknown']) {
    const result = run([command, filename])
    assert.equal(result.status, 2); assert.equal(result.stdout, '')
  }
  const missing = run(['-refl', resolve(directory, 'missing.json')])
  assert.equal(missing.status, 1); assert.equal(missing.stdout, '')
  assert.equal(run(['-v']).status, 0)
  assert.equal(run(['--help']).status, 0)
  await compare(base, false) // successful recovery after rejected work
  console.log(`Native terminal: ${comparisons} actual-WASM comparisons (${values} values), explicit failures, input preservation and recovery passed.`)
} finally {
  await server.close()
  await rm(directory, { recursive: true, force: true })
}
