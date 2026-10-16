import { calculateVisnovskyEnergyScan, type VisnovskyEnergyCalculator } from '../model/visnovskyEnergyScan'
import { prepareVisnovskyQzRequest, type PreparedVisnovskyQzRequest, type DielectricTensorCalculator } from '../model/visnovskyRequest'
import { calculateParrattEnergyScan, type EnergyScanCalculator } from '../model/parrattEnergyScan'
import { refreshCompoundOptics, type RealTableLookup } from '../model/refreshOpticalConstants'
import { HC_EV_ANGSTROM } from '../model/units'
import { prepareParrattQzRequest, type PreparedParrattQzRequest } from '../model/parrattRequest'
import { postprocessParrattResult } from '../model/parrattResult'
import type { WorkerRequest, WorkerResponse } from './protocol'

export type RealQzCalculator = (request: PreparedParrattQzRequest) => Float64Array

export interface RealEngine {
  calculate: RealQzCalculator
  lookup: RealTableLookup
  energyScan: EnergyScanCalculator
  matrixEnergy: VisnovskyEnergyCalculator
  dielectricTensor: DielectricTensorCalculator
  matrixQz: (request: PreparedVisnovskyQzRequest) => Float64Array
}

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
        const mode = message.kind === 'energyAsymmetry' ? 'dichroic' : 'monochromatic'
        const scan = message.project.calculation.algorithm === 'matrix'
          ? calculateVisnovskyEnergyScan(message.project, message.tables ?? [], engine.lookup, engine.dielectricTensor, engine.matrixEnergy, mode)
          : calculateParrattEnergyScan(message.project, message.tables ?? [], engine.lookup, engine.energyScan, mode)
        send({ id: message.id, type: 'result', result: message.kind === 'energyScan'
          ? { energy: scan.energy, reflectivity: scan.reflectivity }
          : { energy: scan.energy, reflectivityPlus: scan.reflectivityPlus, reflectivityMinus: scan.reflectivityMinus, asymmetry: scan.asymmetry } })
        return
      }
      let project = message.project
      let dielectricTensors: (Float64Array | null)[] | undefined
      if (project.calculation.automaticOpticalConstants) {
        // Filldb reads LambdaToEnergy after the GUI has stored EnergyToLambda.
        const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy)
        const refreshed = refreshCompoundOptics(project, message.tables ?? [], energy, engine.lookup)
        dielectricTensors = refreshed.dielectricTensors
        project = { ...project, sample: { ...project.sample, layers: refreshed.layers },
          calculation: { ...project.calculation, automaticOpticalConstants: false } }
      }
      const mode = message.kind === 'reflectivity' ? 'monochromatic' : 'dichroic'
      let qz: number[], values: Float64Array
      if (project.calculation.algorithm === 'matrix') {
        const request = prepareVisnovskyQzRequest(project, mode, engine.dielectricTensor, dielectricTensors)
        qz = request.qz
        values = engine.matrixQz(request)
      } else {
        const request = prepareParrattQzRequest(project, mode)
        qz = request.qz
        values = engine.calculate(request)
      }
      const result = postprocessParrattResult(message.project, qz, values, mode)
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
