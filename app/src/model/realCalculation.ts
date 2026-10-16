import { prepareZakQzRequest, calculateZakEnergyScan, type PreparedZakQzRequest, type ZakEnergyCalculator } from './zakRequest'
import { calculateVisnovskyEnergyScan, type VisnovskyEnergyCalculator } from './visnovskyEnergyScan'
import { prepareVisnovskyQzRequest, type PreparedVisnovskyQzRequest, type DielectricTensorCalculator } from './visnovskyRequest'
import { calculateParrattEnergyScan, type EnergyScanCalculator } from './parrattEnergyScan'
import { refreshCompoundOptics, type RealTableLookup } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'
import { prepareParrattQzRequest, type PreparedParrattQzRequest } from './parrattRequest'
import { postprocessParrattResult } from './parrattResult'
import type { Project } from './project'
import type { OpticalTable } from '../import/tables'

export type RealQzCalculator = (request: PreparedParrattQzRequest) => Float64Array

export interface RealCalculationEngine {
  calculate: RealQzCalculator
  lookup: RealTableLookup
  energyScan: EnergyScanCalculator
  zakQz: (request: PreparedZakQzRequest) => Float64Array
  zakEnergy: ZakEnergyCalculator
  matrixEnergy: VisnovskyEnergyCalculator
  dielectricTensor: DielectricTensorCalculator
  matrixQz: (request: PreparedVisnovskyQzRequest) => Float64Array
}

export type RealCurve = ReturnType<typeof postprocessParrattResult> & { energy?: number[] }

// Shared calculation preparation for plots and dataset objectives.
export function calculateRealCurve(original: Project, tables: OpticalTable[], engine: RealCalculationEngine,
  scan: 'qz' | 'energy', mode: 'monochromatic' | 'dichroic'): RealCurve {
  if (scan === 'energy') {
    return original.calculation.algorithm === 'matrix'
      ? calculateVisnovskyEnergyScan(original, tables, engine.lookup, engine.dielectricTensor, engine.matrixEnergy, mode)
      : original.calculation.algorithm === 'zak'
        ? calculateZakEnergyScan(original, tables, engine.lookup, engine.zakEnergy, mode)
        : calculateParrattEnergyScan(original, tables, engine.lookup, engine.energyScan, mode)
  }
  let project = original
  let dielectricTensors: (Float64Array | null)[] | undefined
  if (project.calculation.automaticOpticalConstants) {
    // Filldb reads LambdaToEnergy after the GUI has stored EnergyToLambda.
    const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy)
    const refreshed = refreshCompoundOptics(project, tables, energy, engine.lookup)
    dielectricTensors = refreshed.dielectricTensors
    project = { ...project, sample: { ...project.sample, layers: refreshed.layers },
      calculation: { ...project.calculation, automaticOpticalConstants: false } }
  }
  let qz: number[], values: Float64Array
  if (project.calculation.algorithm === 'matrix') {
    const request = prepareVisnovskyQzRequest(project, mode, engine.dielectricTensor, dielectricTensors)
    qz = request.qz
    values = engine.matrixQz(request)
  } else if (project.calculation.algorithm === 'zak') {
    const request = prepareZakQzRequest(project, mode)
    qz = request.qz
    values = engine.zakQz(request)
  } else {
    const request = prepareParrattQzRequest(project, mode)
    qz = request.qz
    values = engine.calculate(request)
  }
  const result = postprocessParrattResult(original, qz, values, mode)
  return result
}
