// Test-only sanitization: never return input text, filenames or unknown details.
// Specific capability/data failures precede broad words such as "scattering".
export function diagnosticCategory(message: string): string {
  if (message.includes('comparison-timeout')) return 'worker-timeout'
  if (message.includes('planned for a later release')) return 'deferred-algorithm'
  if (message.includes('Full .F scattering tensor refresh is unavailable')) return 'scattering-tensor-decision'
  if (/Element \d+: missing .*\.ff table/.test(message)) return 'missing-element-table'
  if (/Element \d+: .* eV is outside .*\.ff/.test(message)) return 'element-table-range'
  if (/Lua|BeforeCalculation|Default:/i.test(message)) return 'script'
  if (/binding/.test(message)) return 'profile-binding'
  if (/spline/i.test(message)) return 'spline'
  if (/element|scattering/i.test(message)) return 'element'
  if (/table|database|\.db|\.ff/i.test(message)) return 'table'
  if (/algorithm|not available|not implemented/i.test(message)) return 'unsupported'
  return 'other'
}
