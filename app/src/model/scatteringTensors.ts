export interface ScatteringTensorRequest {
  factors: [number, number, number, number]
  gamma: number
  phi: number
  tensor: 0 | 1
  magnetic: 0 | 1
}
export type ScatteringTensorCalculator = (request: ScatteringTensorRequest) => Float64Array

export function copyScatteringTensors(values: readonly Float64Array[]): Float64Array[] {
  return values.map(value => {
    if (value.length !== 18 || !value.every(Number.isFinite)) throw new Error('Invalid element scattering tensor')
    return value.slice()
  })
}

/** Calculation-owned state; no new user-visible Lua globals. */
export function createScatteringTensorWorkspace(initial: readonly Float64Array[]) {
  let values = copyScatteringTensors(initial)
  return {
    snapshot: () => copyScatteringTensors(values),
    replace(next: readonly Float64Array[]) {
      if (next.length !== values.length) throw new Error('Scattering tensor element count changed')
      values = copyScatteringTensors(next)
    },
  }
}
