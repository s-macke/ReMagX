import { diagnosticCategory } from './real-service/diagnosticCategory'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('fails private comparison setup without disclosing paths or changing corpus inputs', () => {
  for (const scenario of ['empty', 'symlink', 'incomplete']) {
    const directory = mkdtempSync(join(tmpdir(), 'private-diagnostic-marker-'))
    const marker = 'PRIVATE_DIAGNOSTIC_CONTENT_MARKER'
    const source = join(directory, `${marker}.all`)
    try {
      if (scenario === 'symlink') symlinkSync(join(directory, 'missing-private-target'), source)
      if (scenario === 'incomplete') writeFileSync(source, marker)
      const result = spawnSync(process.execPath, [resolve('scripts/diagnose-private-corpus.mjs')], {
        env: { ...process.env, LEGACY_ROOT: directory }, encoding: 'utf8', timeout: 20000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(1)
      const output = result.stdout + result.stderr
      expect(output).toContain('Private corpus comparison failed; diagnostics withheld.')
      expect(output).not.toContain(marker)
      expect(output).not.toContain(directory)
      if (scenario === 'incomplete') expect(readFileSync(source, 'utf8')).toBe(marker)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }
}, 60000)


it('separates deferred algorithms, missing element data and pending tensor behavior without disclosing details', () => {
  const marker = 'PRIVATE_DIAGNOSTIC_MARKER'
  const cases = [
    ['Parratt without multiple scattering is planned for a later release and is not available in the real engine.', 'deferred-algorithm'],
    ['Full .F scattering tensor refresh is unavailable pending the legacy element-assignment decision.', 'scattering-tensor-decision'],
    [`Element 2: missing ${marker}.ff table; built-in tables are unavailable.`, 'missing-element-table'],
    [`Element 2: 700 eV is outside ${marker}.ff.`, 'element-table-range'],
    [`BeforeCalculation: element index error ${marker}`, 'script'],
    [`missing ${marker}.db table`, 'table'],
    [`unrecognized failure ${marker}`, 'other'],
  ]
  for (const [message, category] of cases) {
    expect(diagnosticCategory(message)).toBe(category)
    expect(diagnosticCategory(message)).not.toContain(marker)
  }
})
