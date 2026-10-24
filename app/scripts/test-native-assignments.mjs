// Compare the native byte/token boundary with the production web importer.
// Public fixtures and deterministic synthetic byte sequences only.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/legacy_assignment_tests'))
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true }, appType: 'custom' })
try {
  const { parseAssignments } = await server.ssrLoadModule('/src/import/allFile.ts')
  const inputs = []
  const encoder = new TextEncoder()
  const add = value => inputs.push(typeof value === 'string' ? encoder.encode(value) : Uint8Array.from(value))
  for (const name of (await readdir(resolve(root, 'app/test/fixtures'))).filter(name => name.endsWith('.all')).sort()) {
    add(await readFile(resolve(root, 'app/test/fixtures', name)))
  }
  for (const text of ['', '# no assignment', 'value = 12', 'value = 12\n', 'value = 12\n# tail',
    ' x y = 1 2 3 # c\r\n\tkey\t=\t 4\t \n', '# ignore=1\n=2\nkey#=3\nkey==4\r5\r\n',
    'script =  print("# not a string escape")\nscript=\tvalue\n',
    '\ufeffkey=1\n', '\ufeff\ufeffkey=2\n', 'key=one\r\rtwo\n', 'key=\0value\n',
    '元 素 = α β 😀\n']) add(text)
  const values = ['0', '-0', '+0', '1.25suffix', '.5x', '1.', '1.e3', '1e', '1e+', '1e-2', '1E+3',
    '0x12', 'Infinity', '-Infinity', 'NaN', '.', '+.', '-x', '1..2', '--1', '１２',
    '9007199254740993', '1.7976931348623157e308', '1.7976931348623159e308', '-1e999',
    '4.9406564584124654e-324', '2.4703282292062327e-324', '2.4703282292062328e-324',
    '1e-999', '-1e-999', '0e999', '0.0000000000000000001', '9'.repeat(400), '-0.000suffix']
  const spaces = ['', '\t', '\v', '\f', '\u00a0', '\u1680', '\u2000', '\u200a', '\u2028', '\u2029',
    '\u202f', '\u205f', '\u3000', '\ufeff', '\u0085', '\u180e', '\u200b']
  for (const prefix of spaces) for (const value of values) add(`n=${prefix}${value}\n`)
  for (let byte = 0; byte < 256; byte++) {
    add([107, 61, byte, 10])
    add([107, 61, 0xe0, byte, 0x80, 10])
    add([107, 61, 0xf4, byte, 0x80, 0x80])
  }
  for (const bytes of [[0xc2], [0xe2,0x82], [0xf0,0x90,0x80], [0xed,0xa0,0x80],
    [0xef,0xbb], [0xf0,0x80,0x80,0x80], [0xf0,0x9f,0x98,0x80], [0xe2,0x82,61,49],
    [0xef,0xbb,0xbf,107,61,49]]) add(bytes)
  const numeric = (value, integer) => {
    const match = (integer ? /^\s*([+-]?\d+)/ : /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/).exec(value)
    if (!match) return null
    const result = Number(match[1])
    if (!Number.isFinite(result)) return String(result)
    return Object.is(result, -0) ? '-0' : result
  }
  const expected = inputs.map(bytes => {
    const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    const assignments = parseAssignments(content)
    return { assignments: assignments.map(entry => ({ ...entry,
      number: numeric(entry.value, false), integer: numeric(entry.value, true) })),
    unterminated: !content.endsWith('\n') && assignments.at(-1)?.line === content.split('\n').length }
  })
  const result = spawnSync(executable, [], { input: inputs.map(bytes => JSON.stringify({ bytes: [...bytes] })).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  const actual = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => assert.deepEqual(value, expected[index], `Native assignment case ${index + 1}`))
  console.log(`Native/web assignment decoding and numeric prefixes: ${inputs.length} cases passed.`)
} finally { await server.close() }
