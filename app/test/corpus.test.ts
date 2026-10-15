// Imports every .all file below CORPUS_DIR (the private legacy corpus, D-20); skipped if unset.
// Run: CORPUS_DIR=/path/to/corpus npm test
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importAllFile } from '../src/import/allFile'

const corpusDir = process.env.CORPUS_DIR

function findAllFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return findAllFiles(path)
    return name.toLowerCase().endsWith('.all') ? [path] : []
  })
}

describe.skipIf(!corpusDir)('legacy corpus import (CORPUS_DIR)', () => {
  const files = corpusDir ? findAllFiles(corpusDir) : []
  it.each(files)('%s', (file) => {
    const { project } = importAllFile(readFileSync(file), file)
    expect(project.sample.layers.length).toBeGreaterThanOrEqual(2)
  })
})
