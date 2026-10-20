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
