// Messages between WorkerComputeService (UI thread) and the compute worker.

import type { OpticalTable } from '../import/tables'
import type { DatabaseValues } from '../model/databaseValues'
import type { TensorPreview } from '../model/tensorView'
import type { Project } from '../model/project'
import type { TensorQuery, AsymmetryCurve, DensityProfiles, DepthProfile, ElementSpectrumQuery, LayerSpectrum, LayerSpectrumQuery, EnergyScanCurve, FitProgress, FitResult, ReflectivityCurve } from './ComputeService'

export interface CalculationResults {
  dielectricTensor: TensorPreview
  databaseValues: DatabaseValues
  densityProfiles: DensityProfiles
  scatteringFactors: LayerSpectrum
  layerSpectrum: LayerSpectrum
  reflectivity: ReflectivityCurve
  energyScan: EnergyScanCurve
  asymmetry: AsymmetryCurve
  depthProfile: DepthProfile
  chi2: number
  fit: FitResult
}

export type CalculationKind = Exclude<keyof CalculationResults, 'fit' | 'layerSpectrum' | 'scatteringFactors' | 'databaseValues' | 'dielectricTensor'>

export type WorkerRequest =
  | { id: number; kind: 'dielectricTensor'; project: Project; spectrum: TensorQuery }
  | { id: number; kind: 'databaseValues'; project: Project; spectrum: { tables: OpticalTable[] } }
  | { id: number; kind: 'scatteringFactors'; project: Project; spectrum: ElementSpectrumQuery }
  | { id: number; kind: 'layerSpectrum'; project: Project; spectrum: LayerSpectrumQuery }
  | { id: number; kind: CalculationKind; project: Project }
  | { id: number; kind: 'fit'; project: Project }
  | { kind: 'stopFit' }

export type WorkerResponse =
  | { id: number; type: 'result'; result: CalculationResults[keyof CalculationResults] }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'fitProgress'; progress: FitProgress }
