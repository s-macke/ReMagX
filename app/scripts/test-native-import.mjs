// Native/web import comparison. Optional private corpus stays in memory and
// never appears in diagnostics, snapshots, artifacts or assertion diffs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/legacy_import_tests'))
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true }, appType: 'custom' })
try {
  const { importAllFile } = await server.ssrLoadModule('/src/import/allFile.ts')
  const cases = []
  const add = content => cases.push({ bytes: [...Buffer.from(content)], name: 'comparison.ALL' })
  for (const name of (await readdir(resolve(root, 'app/test/fixtures'))).filter(name => name.endsWith('.all')).sort())
    add(await readFile(resolve(root, 'app/test/fixtures', name)))
  add('')
  const prefix = 'fileversion = 1\nlayerversion=3\nlayer=0\nlayer_d=0\nlayer=1\nlayer_d=10\nlayer=2\n' +
    'element=Fe\nel_layer=0\nel_layer=1\nmagneticversion=4\ngauss_function=0\n' +
    'fitvariableversion=1\nfit_variable=0\nfit_id=0\nmeasurementdataversion=2\ndatasetnumber=1\ndataset_qz=.1\n'
  const source = await readFile(resolve(root, 'app/src/import/allFile.ts'), 'utf8')
  const keys = [...new Set([...source.matchAll(/case '([^']+)'/g)].map(match => match[1]))]
  for (const key of keys) for (const value of ['0', '1', '-1', '2.75suffix', 'bad', '1e999']) add(`${prefix}${key}=${value}\n`)
  for (const key of keys.filter(key => /^(layer_|el_|gauss_|fit_|dataset)/.test(key))) add(`${key}=.3\n`)
  for (const content of [
    'layer=0\nlayer_z=-3\nlayer=1\nlayer_z=10\nlayer=2\nlayer_z=20\nlayer=3\n',
    'layer=0\nlayer_z=0\nlayer=1\nlayer_z=4\nlayerversion=3\nlayer=0\nlayer=1\nlayer=2\n',
    'gauss_function=0\ngauss_splinex=1\ngauss_spliney=2\nmagneticversion=4\ngauss_function=0\ngauss_splinex=3\n',
    'gauss_function=0\ngauss_splinex=1\ngauss_function=1\ngauss_spliney=2\n',
    'measuremult=3\ndeltaqz=.01\ndatasetnumber=0\ndatasettitle=empty\ndatasetnumber=1\ndataset_qz=.1\ndataset_R0=.2\ndataset_R0=.3\nactivedatasetindex=1\n',
    'datasetnumber=1\ndatasettitle=\u00a0\t A title \u3000\ndatasetcomment=\ufeff comment \t\ndatasetfile= path name \n dataset_qz=1\n',
    'scriptline=  print("# x")\ndefaultscriptline= a=b\nscriptparameters=-0\nscriptparameters=2\n',
    '__proto__=one\nconstructor=two\ntoString=three\n__proto__=four\n',
    'future_key=one\nlayer_fitd=1\nfuture_key=two\nother_key=3\nlayer_fitd=0\nprecision=100\n',
    'fitalgorithm=3\nfit_variable=0\nfit_id=0\nfit_value=0\nfit_upper_boundary=0\nfit_delta=50\n',
    'energy=0\nenergy=bad\nlambda=0\n', 'energy=900',
  ]) add(content)
  const publicCount = cases.length
  if (process.env.CORPUS_DIR !== undefined) {
    const { discoverCorpus } = await server.ssrLoadModule('/test/corpusSupport.ts')
    try { for (const path of discoverCorpus(process.env.CORPUS_DIR)) add(await readFile(path)) }
    catch { throw new Error('Private import corpus discovery/read failed; paths withheld.') }
  }
  const expected = cases.map(entry => {
    try { return { ok: true, ...importAllFile(Uint8Array.from(entry.bytes), entry.name) } }
    catch { return { ok: false } }
  })
  const result = spawnSync(executable, [], { input: cases.map(entry => JSON.stringify(entry)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60000 })
  assert.equal(result.status, 0, 'Native import process failed; private diagnostics withheld.')
  const actual = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.equal(actual.length, expected.length, 'Native import result count differs.')
  const mismatchPath = (actual, expected, path = '') => {
    if (isDeepStrictEqual(actual, expected)) return null
    if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return path
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const mismatch = mismatchPath(actual[key], expected[key], `${path}/${key}`)
      if (mismatch !== null) return mismatch
    }
    return path
  }
  actual.forEach((entry, index) => {
    const reference = expected[index]
    const label = `Import case ${index + 1}`
    assert.equal(entry.ok, reference.ok, `${label}: acceptance differs`)
    if (!reference.ok) return
    const mismatch = mismatchPath(entry.project, reference.project)
    assert.equal(mismatch, null, `${label}: project differs at ${mismatch}`)
    assert.ok(isDeepStrictEqual(entry.ignoredKeys, reference.report.ignoredKeys), `${label}: ignored-key report differs`)
    const metadata = messages => messages.map(({ level, line }) => ({ level, ...(line === undefined ? {} : { line }) }))
    assert.ok(isDeepStrictEqual(metadata(entry.messages), metadata(reference.report.messages)), `${label}: report severity/line order differs`)
  })
  console.log(`Native/web full import: ${publicCount} public cases and ${cases.length - publicCount} private projects passed; project fields and report metadata agree.`)
} finally { await server.close() }
