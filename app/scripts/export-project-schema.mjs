// The web schema is authoritative. Export only the supported JSON-Schema subset;
// the one cross-column refinement has an explicit native extension below.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { z } from 'zod'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const check = process.argv[2] === '--check'
assert.ok((check && process.argv.length === 3) || process.argv.length === 2, 'Usage: export-project-schema.mjs [--check]')
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true }, appType: 'custom' })
try {
  const { projectSchema, datasetSchema } = await server.ssrLoadModule('/src/model/project.ts')
  const { nativeLegacyImportDefaults } = await server.ssrLoadModule('/src/import/allFile.ts')
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const visited = new Set()
  function verifyRefinements(schema) {
    if (visited.has(schema)) return
    visited.add(schema)
    // This build-time inspection is pinned by package-lock's Zod version. Fail
    // if a new custom refinement would otherwise disappear during export.
    const definition = schema._zod.def
    const custom = (definition.checks ?? []).filter(check => check._zod.def.check === 'custom')
    assert.equal(custom.length, schema === datasetSchema ? 1 : 0, 'Unmapped custom project-schema refinement')
    switch (definition.type) {
      case 'object': Object.values(schema.shape).forEach(verifyRefinements); break
      case 'array': verifyRefinements(schema.element); break
      case 'optional': case 'nullable': verifyRefinements(schema.unwrap()); break
      case 'number': case 'string': case 'boolean': case 'enum': case 'literal': break
      default: throw new Error(`Unsupported project-schema kind: ${definition.type}`)
    }
  }
  verifyRefinements(projectSchema)
  const schema = z.toJSONSchema(projectSchema, { io: 'input', reused: 'inline' })
  schema.properties.datasets.items.properties.columns['x-remagx-equal-column-lengths'] = 'qz'
  const supported = new Set(['$schema', 'type', 'const', 'enum', 'properties', 'required', 'items',
    'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'anyOf',
    'x-remagx-equal-column-lengths'])
  function verifyKeywords(node) {
    for (const key of Object.keys(node)) assert.ok(supported.has(key), `Unsupported native schema keyword: ${key}`)
    Object.values(node.properties ?? {}).forEach(verifyKeywords)
    if (node.items) verifyKeywords(node.items)
    node.anyOf?.forEach(verifyKeywords)
  }
  verifyKeywords(schema)
  const outputs = [
    ['engine/schema/project-v1.schema.json', schema],
    ['engine/schema/legacy-import-defaults.json', nativeLegacyImportDefaults()],
    ['engine/tests/fixtures/project-v1.json', createDefaultProject()],
  ]
  for (const [name, content] of outputs) {
    const path = resolve(root, name), text = JSON.stringify(content, null, 2) + '\n'
    if (check) assert.equal(await readFile(path, 'utf8'), text, `${name} is stale; regenerate the native schema`)
    else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
  }
  console.log(`Native project schema/default fixture ${check ? 'verified' : 'exported'} from the web model.`)
} finally { await server.close() }
