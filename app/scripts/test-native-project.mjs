// Public fixtures only: prove native JSON documents remain readable by the web model.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/project_document_tests'))
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true }, appType: 'custom' })
try {
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { validateProject } = await server.ssrLoadModule('/src/model/project.ts')
  const { importAllFile } = await server.ssrLoadModule('/src/import/allFile.ts')
  const projects = [createDefaultProject()]
  for (const name of ['default.all', 'Tut1.all', 'Tut2.all', 'Tut3.all']) {
    projects.push(importAllFile(await readFile(resolve(root, 'app/test/fixtures', name), 'utf8'), name).project)
  }
  for (const project of projects) {
    const document = { ...project, futureMetadata: { negativeZero: -0,
      exactValues: [Number.MIN_VALUE, Number.MAX_VALUE, 0.12345678901234566, 1.0000000000000002],
      unknown: [null, true, 'δ / β, literal -0, "quote", \\backslash, \u0000'] } }
    // JSON.stringify discards the sign of -0; native input must also handle JSON
    // produced by serializers that retain that valid number token.
    const input = JSON.stringify(document).replace('"negativeZero":0', '"negativeZero":-0')
    const output = execFileSync(executable, ['--roundtrip'], { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    const decoded = JSON.parse(output)
    assert.deepEqual(decoded, document)
    const validation = validateProject(decoded)
    assert.equal(validation.ok, true)
    assert.deepEqual(validation.project, project)
  }
  const schema = JSON.parse(await readFile(resolve(root, 'engine/schema/project-v1.schema.json'), 'utf8'))
  function sample(node) {
    if ('const' in node) return node.const
    if (node.enum) return node.enum[0]
    if (node.anyOf) return sample(node.anyOf.find(choice => choice.type !== 'null'))
    const type = Array.isArray(node.type) ? node.type.find(type => type !== 'null') : node.type
    switch (type) {
      case 'object': return Object.fromEntries(Object.entries(node.properties).map(([key, child]) => [key, sample(child)]))
      case 'array': return Array.from({ length: Math.max(node.minItems ?? 0, 1) }, () => sample(node.items))
      case 'string': return 'synthetic'
      case 'boolean': return false
      case 'number': case 'integer': return Math.max(node.minimum ?? 0, (node.exclusiveMinimum ?? -1) + 1)
      default: throw new Error(`Unsupported synthetic schema type: ${type}`)
    }
  }
  const dense = sample(schema)
  assert.equal(validateProject(dense).ok, true, 'Dense fixture must satisfy the actual web schema')
  const cases = new Map()
  function add(document) {
    const text = JSON.stringify(document)
    cases.set(text, validateProject(JSON.parse(text)).ok)
  }
  add(dense)
  function change(path, value, remove = false) {
    const document = structuredClone(dense)
    if (!path.length) { add(value); return }
    let parent = document
    for (const key of path.slice(0, -1)) parent = parent[key]
    if (remove) delete parent[path.at(-1)]
    else parent[path.at(-1)] = value
    add(document)
  }
  function visit(node, path, value) {
    for (const candidate of [null, false, '', {}, []]) change(path, candidate)
    if (node.enum) for (const candidate of [...node.enum, '__invalid_choice__']) change(path, candidate)
    if (node.anyOf) for (const child of node.anyOf) visit(child, path, value)
    const types = Array.isArray(node.type) ? node.type : [node.type]
    if (types.includes('number') || types.includes('integer')) {
      for (const candidate of [-Number.MAX_VALUE, -1, -Number.MIN_VALUE, 0, Number.MIN_VALUE,
        0.5, 1, 2, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE]) change(path, candidate)
    }
    if (node.properties && value !== null) {
      for (const [key, child] of Object.entries(node.properties)) {
        change([...path, key], undefined, true)
        visit(child, [...path, key], value[key])
      }
    }
    if (node.items) {
      for (const length of new Set([0, 1, (node.minItems ?? 1) - 1, (node.maxItems ?? 2) + 1]))
        change(path, Array.from({ length }, () => sample(node.items)))
      visit(node.items, [...path, 0], value[0])
      const laterInvalid = [sample(node.items), null]
      change(path, laterInvalid)
    }
  }
  visit(schema, [], dense)
  const unknown = structuredClone(dense)
  unknown.datasets[0].columns.futureColumn = [1, 2, 3]
  unknown.sample.futureProperty = { arbitrary: true }
  add(unknown) // Unknown columns are stripped before the web cross-column refinement.
  const lines = [...cases.keys()]
  const results = execFileSync(executable, ['--validate-lines'], {
    input: lines.join('\n') + '\n', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }).trim().split('\n')
  assert.equal(results.length, lines.length)
  results.forEach((result, index) => {
    assert.equal(result === '1', cases.get(lines[index]), `Native/web schema mismatch in synthetic case ${index}`)
  })
  const unknownOutput = execFileSync(executable, ['--roundtrip'], {
    input: JSON.stringify(unknown), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
  assert.deepEqual(JSON.parse(unknownOutput), unknown)
  console.log(`Native/web schema parity: ${cases.size} synthetic field/boundary mutations agree.`)
  console.log(`Native/web JSON round trips: ${projects.length} public projects; exact doubles and unknown metadata preserved.`)
} finally { await server.close() }
