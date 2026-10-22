import { compareDiagnosticDensity, compareDiagnosticColumns, compareDiagnosticProfile } from './real-service/diagnosticComparison'
import { diagnosticCategory, withDiagnosticDeadline } from './real-service/diagnosticCategory'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

it('fails private comparison setup without disclosing paths or changing corpus inputs', () => {
  for (const scenario of ['empty', 'symlink', 'incomplete', 'arguments', 'duplicate-energy', 'duplicate-asymmetry', 'profile-energy', 'density-profile', 'duplicate-density']) {
    const directory = mkdtempSync(join(tmpdir(), 'private-diagnostic-marker-'))
    const marker = 'PRIVATE_DIAGNOSTIC_CONTENT_MARKER'
    const source = join(directory, `${marker}.all`)
    try {
      if (scenario === 'symlink') symlinkSync(join(directory, 'missing-private-target'), source)
      if (scenario === 'incomplete' || scenario === 'arguments') writeFileSync(source, marker)
      const result = spawnSync(process.execPath, [resolve('scripts/diagnose-private-corpus.mjs'), ...(scenario === 'arguments' ? [`--${marker}`] : scenario === 'duplicate-energy' ? ['--energy', '--energy'] : scenario === 'duplicate-asymmetry' ? ['--asymmetry', '--asymmetry'] : scenario === 'density-profile' ? ['--density', '--profile'] : scenario === 'duplicate-density' ? ['--density', '--density'] : scenario === 'profile-energy' ? ['--profile', '--energy'] : [])], {
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


it('compares both beams and signed asymmetry independently with unchanged D-23', () => {
  const reference = [[1, .5, .4, -.1], [2, 0, 0, 0]]
  const columns = [
    { name: 'coordinate', values: [1, 2] }, { name: 'plus', values: [.5 + 1e-12, 5e-16] },
    { name: 'minus', values: [.4, 0] }, { name: 'asymmetry', values: [-.1 - 1e-12, -5e-16] },
  ]
  expect(compareDiagnosticColumns(columns, reference)).toMatchObject({ status: 'matched', comparedValues: 8, mismatches: 0 })
  columns[1].values[1] = 2e-15
  columns[3].values[0] = -.11
  expect(compareDiagnosticColumns(columns, reference)).toMatchObject({ status: 'numerical-mismatch', mismatches: 2,
    mismatchesByColumn: { coordinate: 0, plus: 1, minus: 0, asymmetry: 1 } })
  expect(compareDiagnosticColumns(columns, [[1, 2]])).toEqual({ status: 'length-mismatch' })
  columns[2].values[0] = NaN
  expect(compareDiagnosticColumns(columns, reference)).toEqual({ status: 'nonfinite' })
})


it('compares independent smooth and slice profile sections, including a single constant row', () => {
  const reference = { smooth: [[-30, .1, .2, -.3, -.4], [0, .2, .3, -.4, -.5]], segments: [[-30, 0, .15, .25, -.35, -.45]] }
  const actual = structuredClone(reference)
  expect(compareDiagnosticProfile(actual, reference)).toMatchObject({ status: 'matched', points: 2, segmentCount: 1, comparedValues: 16 })
  actual.segments[0][1] = 1
  expect(compareDiagnosticProfile(actual, reference)).toMatchObject({ status: 'numerical-mismatch', mismatchesByColumn: { smooth: 0, segments: 1 } })
  actual.smooth[1][3] = NaN
  expect(compareDiagnosticProfile(actual, reference)).toEqual({ status: 'nonfinite' })
  expect(compareDiagnosticProfile({ smooth: [reference.smooth[0]], segments: [] }, reference)).toEqual({ status: 'length-mismatch' })
  const single = { smooth: [reference.smooth[0]], segments: [] }
  expect(compareDiagnosticProfile(single, single)).toMatchObject({ status: 'matched', comparedValues: 5, segmentCount: 0 })
})


it('compares every density column and element boundary group without accepting regrouped marks', () => {
  const reference = { smooth: [[-30, .1, .2], [0, .2, .3]], boundaries: [[[0, .2], [10, .1]], [[0, .3]]] }
  const actual = structuredClone(reference)
  expect(compareDiagnosticDensity(actual, reference)).toMatchObject({ status: 'matched', points: 2, boundaryCount: 3, comparedValues: 12 })
  actual.smooth[1][2] = .4
  actual.boundaries[0][1][0] = 11
  expect(compareDiagnosticDensity(actual, reference)).toMatchObject({ status: 'numerical-mismatch', mismatches: 2,
    mismatchesByColumn: { coordinate: 0, element0: 0, element1: 1, boundaries: 1 } })
  actual.boundaries = [reference.boundaries[1], reference.boundaries[0]]
  expect(compareDiagnosticDensity(actual, reference)).toEqual({ status: 'length-mismatch' })
  const invalid = structuredClone(reference); invalid.smooth[0][1] = NaN
  expect(compareDiagnosticDensity(invalid, reference)).toEqual({ status: 'nonfinite' })
  const noMarks = { smooth: [[0, .1]], boundaries: [[]] }
  expect(compareDiagnosticDensity(noMarks, noMarks)).toMatchObject({ status: 'matched', comparedValues: 2, boundaryCount: 0 })
})
