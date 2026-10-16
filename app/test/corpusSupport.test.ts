import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { discoverCorpus, validateCorpusFile } from './corpusSupport'

const directories: string[] = []
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'remagx-corpus-'))
  directories.push(directory)
  return directory
}
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })))

it('rejects absent, empty, missing and non-directory corpus roots', () => {
  const directory = temporaryDirectory()
  expect(() => discoverCorpus(undefined)).toThrow('CORPUS_DIR')
  expect(() => discoverCorpus('')).toThrow('CORPUS_DIR')
  expect(() => discoverCorpus(directory)).toThrow('no .all projects')
  expect(() => discoverCorpus(join(directory, 'private-missing'))).toThrow('Paths are withheld')
  const file = join(directory, 'private.all')
  writeFileSync(file, '')
  expect(() => discoverCorpus(file)).toThrow('Paths are withheld')
})

it('finds nested .all files case-insensitively and rejects symbolic links without leaking their paths', () => {
  const directory = temporaryDirectory()
  mkdirSync(join(directory, 'nested'))
  writeFileSync(join(directory, 'nested', 'secret.ALL'), '')
  writeFileSync(join(directory, 'ignored.txt'), '')
  expect(discoverCorpus(directory)).toEqual([join(directory, 'nested', 'secret.ALL')])
  symlinkSync(directory, join(directory, 'sensitive-link'))
  expect(() => discoverCorpus(directory)).toThrow(/^Private corpus discovery failed: check directory access and remove symbolic links. Paths are withheld\.$/)
})

it('withholds parser data and filesystem errors', () => {
  const directory = temporaryDirectory()
  const file = join(directory, 'sensitive-project.all')
  writeFileSync(file, 'fileversion = secret-unsupported-version\n')
  expect(() => validateCorpusFile(file)).toThrow(/^Private corpus project could not be read, imported or schema-validated. Details are withheld\.$/)
  expect(() => validateCorpusFile(join(directory, 'missing-private.all'))).toThrow('Details are withheld')
})
