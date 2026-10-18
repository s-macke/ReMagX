import { prepareZakQzRequest, calculateZakEnergyScan, type PreparedZakQzRequest, type ZakEnergyCalculator } from './zakRequest'
import { calculateVisnovskyEnergyScan, type VisnovskyEnergyCalculator } from './visnovskyEnergyScan'
import { prepareVisnovskyQzRequest, type PreparedVisnovskyQzRequest, type DielectricTensorCalculator } from './visnovskyRequest'
import { calculateParrattEnergyScan, type EnergyScanCalculator } from './parrattEnergyScan'
import { refreshPartialCompoundOptics, type RealTableLookup, type SerialOpticalState } from './refreshOpticalConstants'
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

export type RealCurve = ReturnType<typeof postprocessParrattResult> & { energy?: number[]; opticalState: SerialOpticalState; finalEnergy: number; scriptedProject?: Project }

export type RealBeforeCalculation = (project: Project, opticalState: SerialOpticalState, renewOpticalConstants?: number) => {
  project: Project; opticalState: SerialOpticalState
}

// Shared calculation preparation for plots and dataset objectives.
export function calculateRealCurve(original: Project, tables: OpticalTable[], engine: RealCalculationEngine,
  scan: 'qz' | 'energy', mode: 'monochromatic' | 'dichroic', previous?: SerialOpticalState, beforeCalculation?: RealBeforeCalculation): RealCurve {
  if (scan === 'energy') {
    return original.calculation.algorithm === 'matrix'
      ? calculateVisnovskyEnergyScan(original, tables, engine.lookup, engine.dielectricTensor, engine.matrixEnergy, mode, previous)
      : original.calculation.algorithm === 'zak'
        ? calculateZakEnergyScan(original, tables, engine.lookup, engine.zakEnergy, mode, previous)
        : calculateParrattEnergyScan(original, tables, engine.lookup, engine.energyScan, mode, previous)
  }
  let scriptedProject: Project | undefined
  let project = original
  let cursors = new Map(previous?.cursors)
  let dielectricState = previous?.dielectricState
  let dielectricTensors = previous?.dielectricTensors ?? project.sample.layers.map(() => null)
  if (project.calculation.automaticOpticalConstants) {
    // Filldb reads LambdaToEnergy after the GUI has stored EnergyToLambda.
    const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy)
    const refreshed = refreshPartialCompoundOptics(project, tables, energy, engine.lookup, cursors, dielectricTensors)
    dielectricTensors = refreshed.dielectricTensors
    dielectricState = refreshed.updated.map((updated, index) => updated ? null : dielectricState?.[index] ?? null)
    project = { ...project, sample: { ...project.sample, layers: refreshed.layers },
      calculation: { ...project.calculation, automaticOpticalConstants: false } }
  }
  if (beforeCalculation && project.scripts.enabled && project.scripts.beforeCalculation.trim()) {
    const scripted = beforeCalculation(project, { layers: project.sample.layers, dielectricTensors, dielectricState, cursors })
    scriptedProject = { ...scripted.project, calculation: { ...scripted.project.calculation,
      automaticOpticalConstants: original.calculation.automaticOpticalConstants } }
    project = { ...scripted.project, scripts: { ...scripted.project.scripts, enabled: false } }
    dielectricTensors = scripted.opticalState.dielectricTensors
    dielectricState = scripted.opticalState.dielectricState
    cursors = scripted.opticalState.cursors
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
  const result = postprocessParrattResult(project, qz, values, mode)
  return { ...result, opticalState: { layers: project.sample.layers, dielectricTensors, dielectricState, cursors },
    finalEnergy: project.experiment.energy, ...(scriptedProject ? { scriptedProject } : {}) }
}
