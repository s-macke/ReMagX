import { calculateParrattEnergyScan, type EnergyConvolution } from '../model/parrattEnergyScan'
import { refreshCompoundConstants, type RealTableLookup } from '../model/refreshOpticalConstants'
import { HC_EV_ANGSTROM } from '../model/units'
import { prepareParrattQzRequest, type PreparedParrattQzRequest } from '../model/parrattRequest'
import { postprocessParrattResult } from '../model/parrattResult'
import type { WorkerRequest, WorkerResponse } from './protocol'

export type RealQzCalculator = (request: PreparedParrattQzRequest) => Float64Array

export interface RealEngine { calculate: RealQzCalculator; lookup: RealTableLookup; convolve: EnergyConvolution }

// Uses the existing worker protocol. Unported operations never fall back to the mock.
export function createRealRequestHandler(send: (response: WorkerResponse) => void, load: () => Promise<RealEngine>) {
  let calculator: Promise<RealEngine> | null = null
  return async (message: WorkerRequest): Promise<void> => {
    if (message.kind === 'stopFit') return // Standalone Stop terminates this worker through WorkerComputeService.
    try {
      if (message.kind !== 'reflectivity' && message.kind !== 'asymmetry' && message.kind !== 'energyScan' && message.kind !== 'energyAsymmetry') {
        throw new Error(`The real engine does not support ${message.kind} yet.`)
      }
      calculator ??= load().catch(error => { calculator = null; throw error })
      const engine = await calculator
      if (message.kind === 'energyScan' || message.kind === 'energyAsymmetry') {
        const scan = calculateParrattEnergyScan(message.project, message.tables ?? [], engine.lookup, engine.calculate, engine.convolve, message.kind === 'energyAsymmetry' ? 'dichroic' : 'monochromatic')
        send({ id: message.id, type: 'result', result: message.kind === 'energyScan'
          ? { energy: scan.energy, reflectivity: scan.reflectivity }
          : { energy: scan.energy, reflectivityPlus: scan.reflectivityPlus, reflectivityMinus: scan.reflectivityMinus, asymmetry: scan.asymmetry } })
        return
      }
      let project = message.project
      if (project.calculation.automaticOpticalConstants) {
        // Filldb reads LambdaToEnergy after the GUI has stored EnergyToLambda.
        const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy)
        const layers = refreshCompoundConstants(project, message.tables ?? [], energy, engine.lookup)
        project = { ...project, sample: { ...project.sample, layers },
          calculation: { ...project.calculation, automaticOpticalConstants: false } }
      }
      const request = prepareParrattQzRequest(project, message.kind === 'reflectivity' ? 'monochromatic' : 'dichroic')
      const result = postprocessParrattResult(message.project, request.qz, engine.calculate(request), message.kind === 'reflectivity' ? 'monochromatic' : 'dichroic')
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
