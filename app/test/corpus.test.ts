// Optional in the public suite; npm run test:corpus requires a nonempty CORPUS_DIR.
import { describe, it } from 'vitest'
import { discoverCorpus, validateCorpusFile } from './corpusSupport'

const configured = process.env.CORPUS_DIR !== undefined
const required = process.env.CORPUS_REQUIRED === '1'
const enabled = configured || required
let files: string[] = []
let discoveryError: Error | undefined
if (enabled) {
  try { files = discoverCorpus(process.env.CORPUS_DIR) }
  catch (error) { discoveryError = error as Error }
}

describe.skipIf(!enabled)('private legacy corpus import', () => {
  it('requires an accessible, nonempty corpus when requested', () => {
    if (discoveryError) throw discoveryError
  })
  // Numeric IDs remain deterministic for a fixed corpus. Never put paths into test
  // titles, assertions, parameterized cases or error causes: reporters print them.
  files.forEach((file, index) => {
    it(`private project ${index + 1}`, () => validateCorpusFile(file))
  })
})
