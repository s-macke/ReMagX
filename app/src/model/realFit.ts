import type { FitProgress, FitResult, FitDatasetUpdate, FitDatasetPreview } from '../compute/ComputeService'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import { applyRealFitParameters } from './realFitParameters'
import { prepareRealFitSimplex } from './realFitSimplex'
import { evaluateProjectDatasetError, type FitErrorCalculator } from './projectDatasetError'
import type { RealCalculationEngine, RealBeforeCalculation, ScriptSessionLifetime } from './realCalculation'
import { refreshPartialCompoundOptics, type SerialOpticalState } from './refreshOpticalConstants'
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
  onProgress: (progress: FitProgress) => void, shouldStop = () => false, beforeCalculation?: RealBeforeCalculation, initialOpticalState?: SerialOpticalState): FitResult {
  if (project.fit.algorithm !== 'simplex') throw new Error('Real annealing fits are not implemented yet.')
  if (project.fit.occamQ !== 0) throw new Error('Real fit regularization is not implemented yet.')
  if (!project.fit.parameters.length) throw new Error('Select at least one fit parameter.')
  if (!project.datasets.some(dataset => dataset.active)) throw new Error('Select at least one dataset for fitting.')
  const prepared = prepareRealFitSimplex(project.fit.parameters)
  let current = project
  let opticalState: SerialOpticalState | undefined = initialOpticalState
  const scripted = project.scripts.enabled && project.scripts.beforeCalculation.trim()
  const runHook = (renew: number, nestedSession: ScriptSessionLifetime = 'existing') => {
    if (!scripted || !beforeCalculation) return
    const result = beforeCalculation(current, opticalState ?? { layers: current.sample.layers,
      dielectricTensors: current.sample.layers.map(() => null), cursors: new Map() }, renew, nestedSession)
    current = result.project
    opticalState = result.opticalState
  }
  const touched = new Map<number, Set<keyof FitDatasetUpdate['values']>>()
  const best: { result: FitResult | null; preview?: FitDatasetPreview } = { result: null }
  const objective = (coordinates: Float64Array): number => {
    const candidate = applyRealFitParameters(current, prepared.decode(coordinates))
    for (const parameter of current.fit.parameters) {
      const field = parameter.target
      if (field !== 'angularResolution' && field !== 'intensityScale' && field !== 'qzShift' && field !== 'energyShift') continue
      current.datasets.forEach((dataset, index) => {
        const applies = field === 'qzShift' || field === 'energyShift' ? index === current.activeDatasetIndex : dataset.active
        if (applies) {
          const fields = touched.get(index) ?? new Set<keyof FitDatasetUpdate['values']>()
          fields.add(field); touched.set(index, fields)
        }
      })
    }
    current = candidate.project
    if (current.calculation.automaticOpticalConstants) {
      // CMultiFit refreshes once in the current context before the dataset loop.
      // Filldb's false range return is ignored here; partial updates survive.
      const cursors = new Map(opticalState?.cursors)
      const refreshed = refreshPartialCompoundOptics(current, tables,
        HC_EV_ANGSTROM / (HC_EV_ANGSTROM / current.experiment.energy), engine.lookup, cursors, opticalState?.dielectricTensors)
      opticalState = { scatteringTensors: opticalState?.scatteringTensors, layers: refreshed.layers, dielectricTensors: refreshed.dielectricTensors,
        dielectricState: refreshed.updated.map((updated, index) => updated ? null : opticalState?.dielectricState?.[index] ?? null), cursors }
      current = { ...current, sample: { ...current.sample, layers: refreshed.layers } }
    }
    runHook(1) // CMultiFit::Error explicitly renews before every objective.
    let preview: FitDatasetPreview | undefined
    const evaluated = evaluateProjectDatasetError(current, tables, engine, opticalState, (index, scan, beams, curve) => {
      if (index === project.activeDatasetIndex) {
        preview = { datasetIndex: index, scan, beams, qz: curve.qz, ...(curve.energy ? { energy: curve.energy } : {}),
          reflectivityPlus: curve.reflectivityPlus, reflectivityMinus: curve.reflectivityMinus, asymmetry: curve.asymmetry }
      }
    }, beforeCalculation)
    current = evaluated.project
    opticalState = evaluated.opticalState
    if (!best.result || evaluated.error < best.result.chi2) {
      // Retain the actual evaluated state. Replaying values against a later state
      // can change coordinate-shift targets or optical constants.
      best.preview = preview
      const datasetUpdates: FitDatasetUpdate[] = Array.from(touched, ([index, fields]) => ({ index,
        values: Object.fromEntries(Array.from(fields, field => [field, current.datasets[index][field]])) }))
      best.result = { datasetUpdates, project: current, values: candidate.values.slice(), chi2: evaluated.error, iterations: 0, stopped: false }
    }
    return evaluated.error
  }
  if (shouldStop()) throw new FitStoppedBeforeEvaluation('Stopped before evaluating a fit candidate.')
  runHook(0, 'temporary') // The CMultiFit constructor compiles and executes the script once.
  if (!prepared.simplex.length) {
    objective(new Float64Array())
    const result = best.result!
    onProgress({ iteration: 0, chi2: result.chi2, values: result.values.slice(),
      ...(best.preview ? { datasetPreview: structuredClone(best.preview) } : {}) })
    return result
  }
  const result = minimize({ simplex: prepared.simplex, objective, shouldStop,
    onProgress: progress => {
      if (best.result) onProgress({ iteration: progress.iterations, chi2: best.result.chi2, values: best.result.values.slice(),
        ...(best.preview ? { datasetPreview: structuredClone(best.preview) } : {}) })
    } })
  if (!best.result && result.termination === 'stopped') throw new FitStoppedBeforeEvaluation('Stopped before evaluating a fit candidate.')
  if (!best.result || result.value !== best.result.chi2 || !Number.isSafeInteger(result.iterations) || result.iterations < 0) {
    throw new Error('The real optimizer returned an inconsistent fit result.')
  }
  return { ...best.result, iterations: result.iterations, stopped: result.termination === 'stopped' }
}
