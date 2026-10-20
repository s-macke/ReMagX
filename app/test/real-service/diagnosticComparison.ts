// Test-only, value-free comparison report. D-23 applies separately to every
// coordinate/intensity/asymmetry value, including signed and near-zero values.
export function compareDiagnosticColumns(columns: { name: string; values: readonly number[] }[], reference: readonly (readonly number[])[]) {
  if (!columns.length || columns.some(column => column.values.length !== reference.length) ||
      reference.some(row => row.length !== columns.length)) return { status: 'length-mismatch' as const }
  const mismatchesByColumn = Object.fromEntries(columns.map(column => [column.name, 0]))
  let mismatches = 0, maximumAbsolute = 0, maximumLog10 = 0
  for (let index = 0; index < reference.length; ++index) {
    for (let column = 0; column < columns.length; ++column) {
      const value = columns[column].values[index], expected = reference[index][column]
      if (!Number.isFinite(value) || !Number.isFinite(expected)) return { status: 'nonfinite' as const }
      const difference = Math.abs(value - expected)
      if (difference > 1e-15 + 1e-10 * Math.abs(expected)) {
        ++mismatches
        ++mismatchesByColumn[columns[column].name]
      }
      maximumAbsolute = Math.max(maximumAbsolute, difference)
      if (value > 0 && expected > 0) maximumLog10 = Math.max(maximumLog10, Math.abs(Math.log10(value) - Math.log10(expected)))
    }
  }
  return { status: mismatches ? 'numerical-mismatch' as const : 'matched' as const, points: reference.length,
    comparedValues: reference.length * columns.length, mismatches, mismatchesByColumn, maximumAbsolute, maximumLog10 }
}

export function compareDiagnosticProfile(actual: { smooth: number[][]; segments: number[][] }, reference: { smooth: number[][]; segments: number[][] }) {
  if (!reference.smooth.length || actual.smooth.length !== reference.smooth.length || actual.segments.length !== reference.segments.length ||
      [...actual.smooth, ...reference.smooth].some(row => row.length !== 5) ||
      [...actual.segments, ...reference.segments].some(row => row.length !== 6)) return { status: 'length-mismatch' as const }
  const smooth = compareDiagnosticColumns([{ name: 'smooth', values: actual.smooth.flat() }], reference.smooth.flat().map(value => [value]))
  const segments = compareDiagnosticColumns([{ name: 'segments', values: actual.segments.flat() }], reference.segments.flat().map(value => [value]))
  if (!('points' in smooth)) return smooth
  if (!('points' in segments)) return segments
  const mismatches = smooth.mismatches + segments.mismatches
  return { status: mismatches ? 'numerical-mismatch' as const : 'matched' as const, points: reference.smooth.length,
    segmentCount: reference.segments.length, comparedValues: smooth.comparedValues + segments.comparedValues, mismatches,
    mismatchesByColumn: { ...smooth.mismatchesByColumn, ...segments.mismatchesByColumn },
    maximumAbsolute: Math.max(smooth.maximumAbsolute, segments.maximumAbsolute), maximumLog10: Math.max(smooth.maximumLog10, segments.maximumLog10) }
}
