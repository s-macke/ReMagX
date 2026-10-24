// Preserve the stored double when a displayed field is copied or edited.
// Keep compact exponent notation without limiting significant digits.
export function formatNumber(value: number): string {
  if (value === 0) return Object.is(value, -0) ? '-0' : '0'
  const magnitude = Math.abs(value)
  if (magnitude >= 1e-3 && magnitude < 1e5) return String(value)
  return value.toExponential()
}

export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}
