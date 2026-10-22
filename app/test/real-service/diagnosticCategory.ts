// Test-only sanitization: never return input text, filenames or unknown details.
// Specific capability/data failures precede broad words such as "scattering".
export function diagnosticCategory(message: string): string {
  if (message.includes('Define elements to show their density profiles')) return 'density-mode'
  if (message.includes('legacy density-profile range is undefined')) return 'density-range'
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

// Reject the deadline promise before Stop can synchronously reject the request.
// Otherwise Promise.race can report ComputeCancelled instead of the timeout.
export async function withDiagnosticDeadline<T>(request: Promise<T>, stop: () => void, milliseconds = 120000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([request, new Promise<T>((_, reject) => {
      timer = setTimeout(() => { reject(new Error('comparison-timeout')); stop() }, milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
