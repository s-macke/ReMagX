import { prepareParrattQzRequest, type PreparedParrattQzRequest } from '../model/parrattRequest'
import { unpackParrattResult } from '../model/parrattResult'
import type { WorkerRequest, WorkerResponse } from './protocol'

export type RealQzCalculator = (request: PreparedParrattQzRequest) => Float64Array

// Uses the existing worker protocol. Unported operations never fall back to the mock.
export function createRealRequestHandler(send: (response: WorkerResponse) => void, load: () => Promise<RealQzCalculator>) {
  let calculator: Promise<RealQzCalculator> | null = null
  return async (message: WorkerRequest): Promise<void> => {
    if (message.kind === 'stopFit') return // Standalone Stop terminates this worker through WorkerComputeService.
    try {
      if (message.kind !== 'reflectivity' && message.kind !== 'asymmetry') {
        throw new Error(`The real engine does not support ${message.kind} yet.`)
      }
      const request = prepareParrattQzRequest(message.project, message.kind === 'reflectivity' ? 'monochromatic' : 'dichroic')
      calculator ??= load().catch(error => { calculator = null; throw error })
      const calculate = await calculator
      const result = unpackParrattResult(request.qz, calculate(request), message.project.calculation.asymmetryDefinition)
      send({ id: message.id, type: 'result', result: message.kind === 'reflectivity'
        ? { qz: result.qz, reflectivity: result.reflectivityPlus } : result })
    } catch (error) {
      const status = (error as { status?: number })?.status
      const text = status === 4 ? 'Qz exceeds the legacy calculation boundary.'
        : status === 3 ? 'The real engine could not allocate calculation memory.'
        : status === 2 ? 'The real engine produced a nonfinite numerical result.'
        : status === 1 ? 'The real engine rejected invalid calculation inputs.'
        : error instanceof Error ? error.message : 'The real engine calculation failed.'
      send({ id: message.id, type: 'error', message: text })
    }
  }
}
