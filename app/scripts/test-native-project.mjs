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
      exactValues: [Number.MIN_VALUE, Number.MAX_VALUE, 0.12345678901234567, 1.0000000000000002],
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
  console.log(`Native/web JSON round trips: ${projects.length} public projects; exact doubles and unknown metadata preserved.`)
} finally { await server.close() }
