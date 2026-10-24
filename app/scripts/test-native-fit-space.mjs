// Public cross-language preparation checks; no original optimizer code or data.
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
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { prepareRealFitSimplex } = await server.ssrLoadModule('/src/model/realFitSimplex.ts')
  const { applyRealFitParameters } = await server.ssrLoadModule('/src/model/realFitParameters.ts')
  const { addFitRegularization } = await server.ssrLoadModule('/src/model/fitRegularization.ts')
  const encode = value => Object.is(value, -0) ? '-0' : Number.isFinite(value) ? value : String(value)
  const encoded = values => values.map(encode)
  const serialize = value => JSON.stringify(value, (_, item) => Object.is(item, -0) ? '__negative_zero__' : item).replaceAll('"__negative_zero__"', '-0')
  const row = (value, lowerBound, upperBound, step = 999) => ({ target: 'delta', index: 1, elementIndex: null, value, lowerBound, upperBound, step })
  const inputs = [], expected = []
  const add = parameters => {
    const project = createDefaultProject()
    project.fit.parameters = parameters
    const dimension = parameters.filter(parameter => parameter.lowerBound !== parameter.upperBound).length
    const coordinates = [Array(dimension).fill(0), Array(dimension).fill(1), Array(dimension).fill(-1),
      Array(dimension).fill(.5), Array(dimension).fill(Number.MAX_VALUE), Array(dimension).fill(Infinity),
      Array(dimension).fill(NaN), Array(dimension + 1).fill(0)]
    inputs.push({ project: serialize(project), coordinates: coordinates.map(encoded) })
    try {
      const before = structuredClone(project)
      const prepared = prepareRealFitSimplex(parameters)
      const trials = coordinates.map(coordinates => {
        try {
          const values = prepared.decode(coordinates)
          return { ok: true, values: encoded(values), bounded: encoded(applyRealFitParameters(project, values).values) }
        } catch { return { ok: false } }
      })
      expected.push({ ok: true, simplex: prepared.simplex, vertices: prepared.simplex.map(vertex => encoded(prepared.decode(vertex))), trials })
      assert.deepEqual(project, before)
    } catch { expected.push({ ok: false }) }
  }
  add([])
  add([row(40, 0, 100), row(0, -1, 1, 0), row(0, -1e-9, 1e-9)])
  add([row(100, 0, 10), row(-5, 2, 2), row(-0, -1, 1)])
  add([row(8, 3, 3), row(-0, -0, 0)])
  add([row(0, 1, 0)])
  for (const [lower, upper] of [[1, 1 + Number.EPSILON], [0, Number.MIN_VALUE], [-Number.MIN_VALUE, 0],
    [-Number.MAX_VALUE, Number.MAX_VALUE], [-1e308,-1e307], [1e307,1e308], [-0,0]]) {
    for (const value of [lower, upper, 0, 1, -1]) for (const step of [0, -123, 999]) add([row(value, lower, upper, step)])
  }
  // Deterministic mixed scales and fixed/free rows; scales span realistic units.
  for (let example = 0; example < 90; example++) {
    add(Array.from({ length: example % 7 + 1 }, (_, index) => {
      const scale = 10 ** ((example + index * 3) % 21 - 10)
      const lower = index % 2 ? -scale : 0
      const upper = example % 5 === 0 && index % 2 ? lower : scale
      return row((example % 9 - 4) * scale / 2, lower, upper, index * 17)
    }))
  }
  const regularize = (error, weight, reference, candidate) => {
    inputs.push({ regularization: [encode(error), encode(weight), encoded(reference), encoded(candidate)] })
    try { expected.push({ ok: true, value: encode(addFitRegularization(error, weight, reference, candidate)) }) }
    catch { expected.push({ ok: false }) }
  }
  for (const weight of [0, .1, -2, 1e300, Number.MAX_VALUE, NaN]) {
    for (const candidate of [[0], [-0], [1e-6], [-1e-6], [9.999999999999997e-7], [1e-7], [1e100], [NaN], [Infinity]])
      regularize(3, weight, [10], candidate)
  }
  regularize(-0, 0, [1], [2])
  regularize(-0, 2, [1], [0])
  regularize(1, 0, [Infinity], [0])
  regularize(1, 0, [], [1])
  regularize(1, 2, [3,4,5], [1,2,0.0000001])
  const result = spawnSync(executable, [], { input: inputs.map(input => JSON.stringify(input)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  const actual = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => assert.deepEqual(value, expected[index], `Native fit preparation case ${index + 1}`))
  console.log(`Native/web fit initialization, clipping and regularization: ${inputs.length} cases passed.`)
} finally { await server.close() }
