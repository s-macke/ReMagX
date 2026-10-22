export class OpticalDatabaseError extends Error {}
export class MultilayerError extends Error {}

// Preserve raw Lua diagnostics inside the VM; add user guidance only at the
// worker boundary. Native C API statuses are not legacy RX_* numeric codes.
export class ScriptFailure extends Error {
  readonly phase: 'compilation' | 'execution'

  constructor(phase: 'compilation' | 'execution', error: unknown) {
    super(error instanceof Error ? error.message : String(error))
    this.name = 'ScriptFailure'
    this.phase = phase
  }
}

export function scriptFailure(phase: ScriptFailure['phase'], error: unknown): ScriptFailure {
  return error instanceof ScriptFailure ? error : new ScriptFailure(phase, error)
}

export function calculationErrorMessage(error: unknown): string {
  if (error instanceof ScriptFailure) {
    const guidance = error.phase === 'compilation'
      ? 'Check the Lua syntax at the reported source line.'
      : 'Check the script values and function arguments at the reported source line.'
    return `Lua script ${error.phase} failed. ${guidance}\n${error.message}`
  }
  if (error instanceof OpticalDatabaseError) {
    return `Optical database lookup failed. Load the named optical-constant tables and check that their energy range covers the calculation.\n${error.message}`
  }
  if (error instanceof MultilayerError) {
    return `Multilayer expansion failed. Check the layer indices, repetition counts and parentheses in the multilayer pattern.\n${error.message}`
  }
  const status = (error as { status?: number })?.status
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return status === 4 ? 'Qz exceeds the legacy calculation boundary. Check the qz values and energy; the incident angle cannot exceed 90 degrees.'
    : status === 3 ? 'The real engine could not allocate calculation memory.'
    : status === 2 ? 'The real engine produced a nonfinite numerical result.'
    : status === 1 ? 'The real engine rejected invalid calculation inputs.'
    : detail.trim() ? detail : 'The real engine calculation failed.'
}
