// Formats like the legacy table: plain numbers for "normal" magnitudes, exponent notation otherwise.
export function formatNumber(value: number): string {
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  if (magnitude >= 1e-3 && magnitude < 1e5) return String(Number(value.toPrecision(6)))
  return value.toExponential(5)
}

export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}
