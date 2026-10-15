// Messages between WorkerComputeService (UI thread) and the compute worker.

import type { Project } from '../model/project'
import type { AsymmetryCurve, DepthProfile, EnergyScanCurve, FitProgress, FitResult, ReflectivityCurve } from './ComputeService'

export interface CalculationResults {
  reflectivity: ReflectivityCurve
  energyScan: EnergyScanCurve
  asymmetry: AsymmetryCurve
  depthProfile: DepthProfile
  fit: FitResult
}

export type CalculationKind = Exclude<keyof CalculationResults, 'fit'>

export type WorkerRequest =
  | { id: number; kind: CalculationKind; project: Project }
  | { id: number; kind: 'fit'; project: Project }
  | { kind: 'stopFit' }

export type WorkerResponse =
  | { id: number; type: 'result'; result: CalculationResults[keyof CalculationResults] }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'fitProgress'; progress: FitProgress }
