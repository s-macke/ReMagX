import type { FitProgress, FitResult } from '../compute/ComputeService'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import { applyRealFitParameters } from './realFitParameters'
import { prepareRealFitSimplex } from './realFitSimplex'
import { evaluateProjectDatasetError, type FitErrorCalculator } from './projectDatasetError'
import type { RealCalculationEngine } from './realCalculation'
import { refreshCompoundOpticsState, type SerialOpticalState } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'

export interface SimplexProgress {
  parameters: Float64Array
  value: number
  iterations: number
  evaluations: number
}
export type RealMinimizer = (request: {
  simplex: number[][]
  objective: (coordinates: Float64Array) => number
  shouldStop: () => boolean
  onProgress: (progress: SimplexProgress) => void
}) => {
  termination: 'converged' | 'evaluation-limit' | 'iteration-limit' | 'stopped'
  parameters: Float64Array | null
  value: number | null
  iterations: number
  evaluations: number
}

export class FitStoppedBeforeEvaluation extends Error {}

// Worker-only orchestration; numerical calculation and optimization are injected.
// The fit state advances after each evaluation just as CMultiFit::Error does.
export function runRealFit(project: Project, tables: OpticalTable[],
  engine: RealCalculationEngine & { fitError: FitErrorCalculator }, minimize: RealMinimizer,
  onProgress: (progress: FitProgress) => void, shouldStop = () => false): FitResult {
  if (project.fit.algorithm !== 'simplex') throw new Error('Real annealing fits are not implemented yet.')
  if (project.fit.occamQ !== 0) throw new Error('Real fit regularization is not implemented yet.')
  if (!project.fit.parameters.length) throw new Error('Select at least one fit parameter.')
  if (!project.datasets.some(dataset => dataset.active)) throw new Error('Select at least one dataset for fitting.')
  const prepared = prepareRealFitSimplex(project.fit.parameters)
  let current = project
  let opticalState: SerialOpticalState | undefined
  const best: { result: FitResult | null } = { result: null }
  const objective = (coordinates: Float64Array): number => {
    const candidate = applyRealFitParameters(current, prepared.decode(coordinates))
    current = candidate.project
    if (current.calculation.automaticOpticalConstants) {
      // CMultiFit refreshes once in the current context before the dataset loop.
      // Filldb's false range return is ignored here; partial updates survive.
      const cursors = new Map(opticalState?.cursors)
      const refreshed = refreshCompoundOpticsState(current, tables,
        HC_EV_ANGSTROM / (HC_EV_ANGSTROM / current.experiment.energy), engine.lookup, cursors, opticalState?.dielectricTensors)
      opticalState = { layers: refreshed.layers, dielectricTensors: refreshed.dielectricTensors, cursors }
      current = { ...current, sample: { ...current.sample, layers: refreshed.layers } }
    }
    const evaluated = evaluateProjectDatasetError(current, tables, engine, opticalState)
    current = evaluated.project
    opticalState = evaluated.opticalState
    if (!best.result || evaluated.error < best.result.chi2) {
      // Retain the actual evaluated state. Replaying values against a later state
      // can change coordinate-shift targets or optical constants.
      best.result = { project: current, values: candidate.values.slice(), chi2: evaluated.error, iterations: 0, stopped: false }
    }
    return evaluated.error
  }
  if (shouldStop()) throw new FitStoppedBeforeEvaluation('Stopped before evaluating a fit candidate.')
  if (!prepared.simplex.length) {
    objective(new Float64Array())
    const result = best.result!
    onProgress({ iteration: 0, chi2: result.chi2, values: result.values.slice() })
    return result
  }
  const result = minimize({ simplex: prepared.simplex, objective, shouldStop,
    onProgress: progress => {
      if (best.result) onProgress({ iteration: progress.iterations, chi2: best.result.chi2, values: best.result.values.slice() })
    } })
  if (!best.result && result.termination === 'stopped') throw new FitStoppedBeforeEvaluation('Stopped before evaluating a fit candidate.')
  if (!best.result || result.value !== best.result.chi2 || !Number.isSafeInteger(result.iterations) || result.iterations < 0) {
    throw new Error('The real optimizer returned an inconsistent fit result.')
  }
  return { ...best.result, iterations: result.iterations, stopped: result.termination === 'stopped' }
}
