// Private original-loader comparison: values and compiler diagnostics never
// enter public reports. This is parsed state, not a simulation golden gate.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { it } from 'vitest'
import { importAllFile } from '../src/import/allFile'
import { discoverCorpus } from './corpusSupport'

it.skipIf(!process.env.LEGACY_ROOT)('compares original first-film layer numerics with the importer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'remagx-state-reference-'))
  const executable = join(directory, 'reference')
  try {
    try {
      execFileSync('python3', [resolve('../tools/golden/legacy/build_state_reference.py'),
        '--legacy-root', resolve(process.env.LEGACY_ROOT!), '--output', executable], { stdio: 'pipe', timeout: 60000 })
    } catch { throw new Error('Private loader reference build failed; diagnostics withheld.') }
    const files = process.env.CORPUS_DIR !== undefined ? discoverCorpus(process.env.CORPUS_DIR)
      : ['default.all', 'Tut1.all', 'Tut2.all', 'Tut3.all'].map(name => resolve('test/fixtures', name))
    for (let index = 0; index < files.length; index++) {
      try {
        const original = JSON.parse(execFileSync(executable, [files[index]], { stdio: 'pipe', timeout: 10000 }).toString()) as {
          energy: number; films: number[][][]; datasetCount: number
        }
        const { project } = importAllFile(readFileSync(files[index]))
        const actual = project.sample.layers.map(layer => [layer.thickness, layer.roughness, layer.delta, layer.beta,
          layer.deltaMag, layer.betaMag, layer.magnetization.gamma, layer.magnetization.phi])
        const expected = original.films[0]
        if (actual.length !== expected.length) throw new Error()
        for (let row = 0; row < actual.length; row++) for (let column = 0; column < 8; column++) {
          const reference = expected[row][column], value = actual[row][column]
          if (!Number.isFinite(reference) || !Number.isFinite(value) || Math.abs(value - reference) > 1e-15 + 1e-10 * Math.abs(reference)) throw new Error()
        }
      } catch { throw new Error(`Original loader comparison failed for project ${index + 1}; details withheld.`) }
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 120000)
