// Focused deferred-target rejection at the public native CLI boundary.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'vite'
const executable = resolve(process.argv[2] ?? '../build/engine/remagx-terminal')
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const directory = await mkdtemp(resolve(tmpdir(), 'remagx-fit-capabilities-'))
try {
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { nativeLegacyImportDefaults } = await server.ssrLoadModule('/src/import/allFile.ts')
  const project = createDefaultProject()
  project.calculation.algorithm = 'parratt'; project.calculation.automaticOpticalConstants = false
  project.calculation.roughnessModel = 'nevot-croce'; project.sample.multilayer.enabled = false
  project.scripts.enabled = false; project.fit.occamQ = 0
  project.datasets = [{ ...nativeLegacyImportDefaults().dataset, active: true, energy: 8000,
    columns: { qz: [.03, .06], reflectivity: [.3, .02] } }]
  project.activeDatasetIndex = 0
  project.fit.window = { qzMin: 0, qzMax: 1, energyMin: 0, energyMax: 10000 }
  const file = resolve(directory, 'project.json')
  const run = async () => {
    const saved = JSON.stringify(project)
    await writeFile(file, saved)
    const result = spawnSync(executable, ['-fit', file], { encoding: 'utf8', timeout: 10000 })
    assert.equal(await readFile(file, 'utf8'), saved, 'Input project must stay unchanged')
    assert.ifError(result.error)
    return result
  }
  for (const algorithm of ['simplex', 'simplex-annealing']) {
    project.fit.algorithm = algorithm
    for (const target of ['betaKramersKronig', 'deltaKramersKronig', 'electronEscapeDepth', 'electronGain']) {
      project.fit.parameters = [{ target, index: 1, elementIndex: null, value: 1, step: 1, lowerBound: 0, upperBound: 2 }]
      // Reject before optical preparation and Lua, even when both would fail.
      project.calculation.automaticOpticalConstants = true
      project.sample.layers[1].opticalTable = 'deliberately-missing'
      project.scripts.enabled = true; project.scripts.beforeCalculation = 'error("must not run")'
      const result = await run()
      assert.notEqual(result.status, 0)
      assert.ok(result.stderr.includes(`Fit parameter "${target}" requires ${target.includes('Kramers') ? 'Kramers-Kronig' : 'TEY'}`), result.stderr)
    }
    project.calculation.automaticOpticalConstants = false; project.scripts.enabled = false
    project.fit.parameters = [{ target: 'thickness', index: 1, elementIndex: null, value: 27, step: 1, lowerBound: 27, upperBound: 27 }]
    const result = await run()
    assert.equal(result.status, 0, result.stderr)
  }
  console.log('Native fit capabilities: eight named early rejections and two supported fits pass; inputs unchanged.')
} finally { await server.close(); await rm(directory, { recursive: true, force: true }) }
