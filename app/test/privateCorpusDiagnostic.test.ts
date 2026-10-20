import { diagnosticCategory, withDiagnosticDeadline } from './real-service/diagnosticCategory'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

it('fails private comparison setup without disclosing paths or changing corpus inputs', () => {
  for (const scenario of ['empty', 'symlink', 'incomplete', 'arguments']) {
    const directory = mkdtempSync(join(tmpdir(), 'private-diagnostic-marker-'))
    const marker = 'PRIVATE_DIAGNOSTIC_CONTENT_MARKER'
    const source = join(directory, `${marker}.all`)
    try {
      if (scenario === 'symlink') symlinkSync(join(directory, 'missing-private-target'), source)
      if (scenario === 'incomplete' || scenario === 'arguments') writeFileSync(source, marker)
      const result = spawnSync(process.execPath, [resolve('scripts/diagnose-private-corpus.mjs'), ...(scenario === 'arguments' ? [`--${marker}`] : [])], {
        env: { ...process.env, LEGACY_ROOT: directory }, encoding: 'utf8', timeout: 20000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(1)
      const output = result.stdout + result.stderr
      expect(output).toContain('Private corpus comparison failed; diagnostics withheld.')
      expect(output).not.toContain(marker)
      expect(output).not.toContain(directory)
      if (scenario === 'incomplete' || scenario === 'arguments') expect(readFileSync(source, 'utf8')).toBe(marker)
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


it('reports the diagnostic deadline even when Stop synchronously rejects the pending request', async () => {
  vi.useFakeTimers()
  try {
    let rejectRequest!: (reason: Error) => void
    const request = new Promise<number>((_, reject) => { rejectRequest = reject })
    const stop = vi.fn(() => rejectRequest(new Error('Stopped.')))
    const checked = expect(withDiagnosticDeadline(request, stop, 20)).rejects.toThrow('comparison-timeout')
    await vi.advanceTimersByTimeAsync(20)
    await checked
    expect(stop).toHaveBeenCalledTimes(1)
    const successfulStop = vi.fn()
    await expect(withDiagnosticDeadline(Promise.resolve(42), successfulStop, 20)).resolves.toBe(42)
    await expect(withDiagnosticDeadline(Promise.reject(new Error('original failure')), successfulStop, 20)).rejects.toThrow('original failure')
    await vi.advanceTimersByTimeAsync(100)
    expect(successfulStop).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
