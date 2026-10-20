// Test-only, value-free comparison report. D-23 applies separately to every
// coordinate/intensity/asymmetry value, including signed and near-zero values.
export function compareDiagnosticColumns(columns: { name: string; values: readonly number[] }[], reference: readonly (readonly number[])[]) {
  if (!columns.length || !reference.length || columns.some(column => column.values.length !== reference.length) ||
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
