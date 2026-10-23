import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const hashPattern = /^[a-f0-9]{64}$/
const tablePattern = /\.(db|m|ff|ffm|e|f)$/i
function requireValid(condition) {
  if (!condition) throw new Error('Invalid private fit reference input')
}

export function selectReferences(bundle, selection) {
  requireValid(bundle?.schemaVersion === 1 && Array.isArray(bundle.results) && Array.isArray(bundle.inventory))
  requireValid(Number.isSafeInteger(bundle.referenceIterations) && bundle.referenceIterations > 0)
  const candidates = bundle.results.filter(row => row.iterations === bundle.referenceIterations)
  const allIds = candidates.map(row => row.id)
  requireValid(allIds.every(id => Number.isSafeInteger(id) && id > 0) && new Set(allIds).size === allIds.length)
  const ids = selection === undefined ? undefined : selection.split(',').map(value => {
    requireValid(/^[1-9][0-9]*$/.test(value))
    return Number(value)
  })
  requireValid(ids === undefined || new Set(ids).size === ids.length)
  const rows = candidates.filter(row => row.status === 0 && (ids === undefined || ids.includes(row.id)))
  requireValid(rows.length > 0 && (ids === undefined || rows.length === ids.length))
  for (const row of rows) {
    const result = row.result
    requireValid(row.iterations === bundle.referenceIterations && row.iterations > 0 &&
      result?.iterations === row.iterations && [0, 1].includes(result.algorithm) &&
      Number.isSafeInteger(result.seed) && result.seed >= 0 && result.seed <= 0xffffffff &&
      Number.isFinite(result.error) && result.error >= 0 &&
      Array.isArray(result.values) && result.values.length > 0 && result.values.every(Number.isFinite) &&
      hashPattern.test(row.inputSha256) && row.directoryInputHashes &&
      bundle.inventory.filter(item => item.id === row.id).length === 1)
  }
  return rows
}

async function checkedFile(root, relative) {
  requireValid(typeof relative === 'string' && relative.length > 0 && !relative.includes('\\'))
  const parts = relative.split('/')
  requireValid(parts.every(part => part && part !== '.' && part !== '..'))
  let path = root
  for (const [index, part] of parts.entries()) {
    path = resolve(path, part)
    const stat = await lstat(path)
    requireValid(!stat.isSymbolicLink() && (index === parts.length - 1 ? stat.isFile() : stat.isDirectory()))
  }
  return { path, bytes: await readFile(path) }
}

export async function loadFitInputs(corpus, bundle, selection) {
  requireValid(typeof corpus === 'string' && corpus.trim().length > 0)
  const root = resolve(corpus)
  requireValid(await realpath(root) === root && (await lstat(root)).isDirectory())
  const references = selectReferences(bundle, selection)
  const inputs = []
  for (const reference of references) {
    const item = bundle.inventory.find(item => item.id === reference.id)
    const { path, bytes } = await checkedFile(root, item.path)
    requireValid(sha256(bytes) === reference.inputSha256)
    const tables = []
    const parent = dirname(path)
    const prefix = parent === root ? '' : parent.slice(root.length + sep.length).split(sep).join('/') + '/'
    const hashes = reference.directoryInputHashes
    requireValid(Object.keys(hashes).length > 0)
    for (const [name, hash] of Object.entries(hashes)) {
      requireValid(!name.includes('/') && !name.includes('\\') && hashPattern.test(hash))
      const input = await checkedFile(root, prefix + name)
      requireValid(sha256(input.bytes) === hash)
      if (tablePattern.test(name)) tables.push({ name, source: input.bytes.toString('latin1') })
    }
    // An unrecorded table could change lookup resolution. Never silently load it.
    for (const entry of await readdir(parent)) requireValid(!tablePattern.test(entry) || Object.hasOwn(hashes, entry))
    inputs.push({ id: reference.id, source: bytes.toString('latin1'), tables,
      reference: reference.result, inputHash: reference.inputSha256 })
  }
  return inputs
}

export function summarizeFitComparisons(inputs, reports) {
  const passed = inputs.length === reports.length && inputs.every(input => {
    const matches = reports.filter(report => report.id === input.id)
    const report = matches[0]
    return matches.length === 1 && report.status === 'matched' && report.inputHash === input.inputHash &&
      Number.isFinite(report.chi2) && report.chi2 >= 0 && report.chi2 <= input.reference.error * (1 + 1e-6) &&
      Array.isArray(report.values) && report.values.length === input.reference.values.length && report.values.every(Number.isFinite)
  })
  const distinctProjects = new Set(inputs.map(input => input.inputHash)).size
  return { projects: inputs.length, distinctProjects, passed: passed && distinctProjects >= 3 }
}
