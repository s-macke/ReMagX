import type { OpticalTable } from '../import/tables'
import type { SerialOpticalState } from './refreshOpticalConstants'
import type { Project } from './project'
import { prepareFitDataset, type FitErrorMode } from './fitDataset'
import { calculateRealCurve, type RealCalculationEngine, type RealCurve, type RealBeforeCalculation } from './realCalculation'

export interface FitErrorRequest {
  mode: FitErrorMode
  qz: number[]
  energy?: number[]
  measured: number[]
  calculated: number[]
  measuredSecond?: number[]
  calculatedSecond?: number[]
  qzMin: number
  qzMax: number
  energyMin: number
  energyMax: number
}
export type FitErrorCalculator = (request: FitErrorRequest) => { error: number; accepted: number }

// Unit1.cpp Button22Click: serial weighted dataset means, not the optimizer's Q penalty.
// Zero-weight active datasets are still evaluated, as in legacy; inactive ones are untouched.
export function calculateProjectDatasetError(project: Project, tables: OpticalTable[],
  engine: RealCalculationEngine & { fitError: FitErrorCalculator }): number {
  return evaluateProjectDatasetError(project, tables, engine).error
}

// Return the serial state as well as the objective for the optimizer's next candidate.
export function evaluateProjectDatasetError(project: Project, tables: OpticalTable[],
  engine: RealCalculationEngine & { fitError: FitErrorCalculator }, previous?: SerialOpticalState,
  observe?: (index: number, scan: 'qz' | 'energy', beams: 'monochromatic' | 'dichroic', curve: RealCurve) => void, beforeCalculation?: RealBeforeCalculation) {
  let current = project
  let opticalState = previous
  let total = 0
  for (let index = 0; index < project.datasets.length; index++) {
    if (!project.datasets[index].active) continue
    const prepared = prepareFitDataset(current, index)
    const curve = calculateRealCurve(prepared.project, tables, engine, prepared.scan, prepared.beams, opticalState, beforeCalculation)
    opticalState = curve.opticalState
    const calculatedProject = curve.scriptedProject ?? prepared.project
    current = { ...calculatedProject, sample: { ...calculatedProject.sample, layers: opticalState.layers },
      experiment: { ...calculatedProject.experiment, energy: curve.finalEnergy } }
    const columns = prepared.measurement
    const asymmetry = prepared.errorMode === 2 || prepared.errorMode === 6
    const dichroic = prepared.errorMode === 3 || prepared.errorMode === 7
    const measured = asymmetry ? columns.asymmetry! : dichroic ? columns.reflectivityPlus! : columns.reflectivity!
    const calculated = asymmetry ? curve.asymmetry : curve.reflectivityPlus
    if (curve.qz.length !== columns.qz.length || curve.qz.some((value, point) => value !== columns.qz[point])) {
      throw new Error('Fit calculation and measurement coordinates differ.')
    }
    if (prepared.scan === 'energy' && (!curve.energy ||
        curve.energy.length !== columns.energy!.length || curve.energy.some((value, point) => value !== columns.energy![point]))) {
      throw new Error('Fit calculation and measurement energies differ.')
    }
    const result = engine.fitError({ mode: prepared.errorMode, qz: columns.qz, energy: columns.energy,
      measured, calculated, ...(dichroic ? { measuredSecond: columns.reflectivityMinus!, calculatedSecond: curve.reflectivityMinus } : {}),
      ...project.fit.window })
    if (!Number.isFinite(result.error) || !Number.isSafeInteger(result.accepted) || result.accepted < 0 || result.accepted > columns.qz.length) {
      throw new Error('The real engine returned an invalid dataset error.')
    }
    total += prepared.weight * result.error
    if (!Number.isFinite(total)) throw new Error('Weighted dataset error exceeds the supported numerical range.')
    observe?.(index, prepared.scan, prepared.beams, curve)
  }
  return { error: total, project: current, opticalState }
}
