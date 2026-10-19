// Private original-loader comparison: values and compiler diagnostics never
// enter public reports. This is parsed state, not a simulation golden gate.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { it } from 'vitest'
import { importAllFile } from '../src/import/allFile'
import { discoverCorpus } from './corpusSupport'

it.skipIf(!process.env.LEGACY_ROOT)('compares original layer and dataset numerics with the importer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'remagx-state-reference-'))
  const executable = join(directory, 'reference')
  try {
    try {
      execFileSync('python3', [resolve('../tools/golden/legacy/build_state_reference.py'),
        '--legacy-root', resolve(process.env.LEGACY_ROOT!), '--output', executable], { stdio: 'pipe', timeout: 60000 })
    } catch { throw new Error('Private loader reference build failed; diagnostics withheld.') }
    const files = process.env.CORPUS_DIR !== undefined ? discoverCorpus(process.env.CORPUS_DIR)
      : ['default.all', 'Tut1.all', 'Tut2.all', 'Tut3.all'].map(name => resolve('test/fixtures', name))
    const synthetic = join(directory, 'synthetic.all')
    writeFileSync(synthetic, [
      'fileversion = 1', 'energy = 640', 'layerversion = 3', 'layer = 0', 'layer_d = 0', 'layer = 1', 'layer_d = 0',
      'measuremult = 2', 'deltaqz = -0.2', 'measurementdataversion = 2', 'datasetnumber = 1',
      'datasetlambda = 20', 'datasetenergyshift = -3', 'datasetresolution = 0.004',
      'datasetmultiplicator = -2', 'datasettranslator = 0.03', 'datasetqztranslation = 0.007',
      'dataseterrorweight = -4', 'datasetactive = 1',
      ...['ray1sigmare', 'ray1sigmaim', 'ray1pire', 'ray1piim', 'ray2sigmare', 'ray2sigmaim', 'ray2pire', 'ray2piim']
        .map((key, index) => `dataset${key} = ${(index - 3) / 10}`),
      ...['qz', 'R0', 'Rp', 'Rm', 'A', 'eng', 'TEY'].flatMap((key, index) =>
        [`dataset_${key} = ${index + .03}`, `dataset_${key} = ${index + .01}`]),
      'datasetnumber = 2', 'dataset_qz = 0.1', 'dataset_A = -0.3',
    ].join('\n') + '\n')
    files.push(synthetic)
    for (let index = 0; index < files.length; index++) {
      let stage = 'load', comparisonIndex = -1
      try {
        const original = JSON.parse(execFileSync(executable, [files[index]], { stdio: 'pipe', timeout: 10000, maxBuffer: 32 * 1024 * 1024 }).toString()) as {
          energy: number; films: number[][][]; datasetCount: number
          datasets: { settings: number[]; polarization: number[]; columns: number[][] }[]
        }
        const { project } = importAllFile(readFileSync(files[index]))
        const actual = project.sample.layers.map(layer => [layer.thickness, layer.roughness, layer.delta, layer.beta,
          layer.deltaMag, layer.betaMag, layer.magnetization.gamma, layer.magnetization.phi])
        const expected = original.films[0]
        if (actual.length !== expected.length) throw new Error()
        const compare = (values: number[], references: number[]) => {
          comparisonIndex = -1
          if (values.length !== references.length) throw new Error()
          for (let point = 0; point < values.length; point++) {
            comparisonIndex = point
            const value = values[point], reference = references[point]
            if (!Number.isFinite(reference) || !Number.isFinite(value) || Math.abs(value - reference) > 1e-15 + 1e-10 * Math.abs(reference)) throw new Error()
          }
        }
        stage = 'layers'
        actual.forEach((row, index) => compare(row, expected[index]))
        // When present, original dataset zero is an empty placeholder.
        // Files without loaded datasets can also have no placeholder.
        stage = 'dataset count'; comparisonIndex = -1
        const nativeDatasets = original.datasets[0]?.columns[0].length === 0 ? original.datasets.slice(1) : original.datasets
        if (nativeDatasets.length !== project.datasets.length) throw new Error()
        project.datasets.forEach((dataset, index) => {
          const native = nativeDatasets[index], beam = dataset.polarization
          stage = 'dataset settings'
          compare([dataset.energy, dataset.energyShift, dataset.angularResolution, dataset.intensityScale,
            dataset.intensityOffset, dataset.qzShift, dataset.errorWeight, Number(dataset.active)], native.settings)
          stage = 'dataset polarization'
          compare([beam.beam1.sigma.re, beam.beam1.sigma.im, beam.beam1.pi.re, beam.beam1.pi.im,
            beam.beam2.sigma.re, beam.beam2.sigma.im, beam.beam2.pi.re, beam.beam2.pi.im], native.polarization)
          stage = 'dataset columns'
          const columns = dataset.columns
          ;[columns.qz, columns.reflectivity, columns.reflectivityPlus, columns.reflectivityMinus,
            columns.asymmetry, columns.energy, columns.electronYield].forEach((column, index) => compare(column ?? [], native.columns[index]))
        })
      } catch { throw new Error(`Original loader comparison failed for project ${index + 1}, ${stage}, entry ${comparisonIndex}; values withheld.`) }
    }
    // Explicitly diagnose the original EOF behavior instead of hiding it in
    // the parity tolerance: LoadNextAssignment drops an unterminated last line.
    const unterminated = readFileSync(synthetic, 'utf8').trimEnd()
    writeFileSync(synthetic, unterminated)
    const native = JSON.parse(execFileSync(executable, [synthetic], { stdio: 'pipe', timeout: 10000 }).toString())
    const retained = importAllFile(unterminated)
    if (native.datasets[2].columns[4].length !== 0 || retained.project.datasets[1].columns.asymmetry?.[0] !== -.3 ||
        !retained.report.messages.some(message => message.text.includes('no terminating newline'))) {
      throw new Error('Synthetic unterminated-line diagnostic failed.')
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 120000)
