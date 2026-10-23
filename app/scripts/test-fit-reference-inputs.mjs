import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { loadFitInputs, selectReferences, sha256, summarizeFitComparisons } from './fit-reference-inputs.mjs'

function fixture() {
  return { schemaVersion: 1, referenceIterations: 1000,
    inventory: [{ id: 1, path: 'project.all' }],
    results: [{ id: 1, status: 0, iterations: 1000, inputSha256: sha256('project'),
      directoryInputHashes: { 'project.all': sha256('project'), 'table.db': sha256('table') },
      result: { iterations: 1000, algorithm: 0, seed: 42, error: 2, values: [1] } }] }
}

test('reference selection rejects empty, duplicate, missing and unavailable cases', () => {
  assert.equal(selectReferences(fixture())[0].id, 1)
  const diagnostic = fixture()
  diagnostic.results.push({ ...diagnostic.results[0], iterations: 5 })
  assert.equal(selectReferences(diagnostic).length, 1)
  for (const selection of ['', '1,1', '2', '0', '1,', ' 1']) assert.throws(() => selectReferences(fixture(), selection))
  for (const mutate of [b => { b.results[0].status = 1 }, b => { b.results.push(b.results[0]) },
    b => { b.results[0].result.error = Infinity }, b => { b.results[0].result.seed = -1 },
    b => { b.results[0].result.iterations = 1 }, b => { b.inventory.push(b.inventory[0]) }]) {
    const bundle = fixture(); mutate(bundle); assert.throws(() => selectReferences(bundle))
  }
})

test('inputs enforce recorded bytes, table inventory and non-symlink paths', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'remagx-fit-input-test-'))
  try {
    await writeFile(resolve(root, 'project.all'), 'project')
    await writeFile(resolve(root, 'table.db'), 'table')
    assert.equal((await loadFitInputs(root, fixture()))[0].tables.length, 1)
    await writeFile(resolve(root, 'table.db'), 'changed')
    await assert.rejects(loadFitInputs(root, fixture()))
    await writeFile(resolve(root, 'table.db'), 'table')
    await writeFile(resolve(root, 'extra.ff'), 'extra')
    await assert.rejects(loadFitInputs(root, fixture()))
    await rm(resolve(root, 'extra.ff'))
    await rm(resolve(root, 'table.db'))
    await symlink('project.all', resolve(root, 'table.db'))
    await assert.rejects(loadFitInputs(root, fixture()))
    await rm(resolve(root, 'table.db'))
    await writeFile(resolve(root, 'table.db'), 'table')
    await mkdir(resolve(root, 'nested'))
    await symlink('.', resolve(root, 'link'))
    for (const path of ['../project.all', '/project.all', 'nested/../project.all', 'link/project.all', 'nested\\project.all']) {
      const bundle = fixture(); bundle.inventory[0].path = path
      await assert.rejects(loadFitInputs(root, bundle))
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('gate requires all results, three distinct inputs, finite outputs and D-28 without absolute slack', () => {
  const inputs = [1, 2, 3].map(id => ({ id, inputHash: sha256(String(id)), reference: { error: 2, values: [1] } }))
  const reports = inputs.map(input => ({ id: input.id, inputHash: input.inputHash, status: 'matched', chi2: 2 * (1 + 1e-6), values: [1] }))
  assert.equal(summarizeFitComparisons(inputs, reports).passed, true)
  for (const mutate of [r => r.pop(), r => r.push(r[0]), r => { r[0].chi2 = 2.000003 },
    r => { r[0].status = 'worker-timeout' }, r => { r[0].values = [NaN] },
    r => { r[0].inputHash = 'wrong' }, r => { r[0].chi2 = -1 }]) {
    const copy = structuredClone(reports); mutate(copy)
    assert.equal(summarizeFitComparisons(inputs, copy).passed, false)
  }
  const duplicates = inputs.map(input => ({ ...input, inputHash: inputs[0].inputHash }))
  assert.equal(summarizeFitComparisons(duplicates, reports.map(report => ({ ...report, inputHash: inputs[0].inputHash }))).passed, false)
  inputs[0].reference.error = 0; reports[0].chi2 = 1e-30
  assert.equal(summarizeFitComparisons(inputs, reports).passed, false)
})
