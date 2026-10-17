import type { ElementConversion } from '../model/materialElements'
// The interface between the UI and the numerics (D-7, D-12, D-33). The UI depends only on
// ComputeService; today it is backed by a Web Worker running the TypeScript mock engine, later
// by the same worker running the WebAssembly engine.

import type { OpticalTable } from '../import/tables'
import type { DatabaseValues } from '../model/databaseValues'
import type { TensorPreview } from '../model/tensorView'
import type { Layer, Project } from '../model/project'

export interface TensorQuery { layerIndex: number; tables: OpticalTable[]; spectrum: boolean }
export interface ElementSpectrumQuery { elementIndex: number; tables: OpticalTable[] }
export interface LayerSpectrumQuery { elementIndex?: number; layerIndex: number; magnetic: boolean; tables: OpticalTable[] }
export interface LayerSpectrum { energy: number[]; first: number[]; second: number[] }

export interface DensityProfiles {
  z: number[]
  elements: { name: string; density: number[]; boundaries: { z: number; density: number }[] }[]
}

export interface ReflectivityCurve {
  scriptMessages?: string[]
  qz: number[]
  reflectivity: number[]
}

export interface EnergyScanCurve {
  energy: number[]
  reflectivity: number[]
}

export interface EnergyAsymmetryCurve {
  energy: number[]
  reflectivityPlus: number[]
  reflectivityMinus: number[]
  asymmetry: number[]
}

// Reflectivity for the two beams (legacy "dichroic" mode) and their asymmetry.
export interface AsymmetryCurve {
  scriptMessages?: string[]
  qz: number[]
  reflectivityPlus: number[]
  reflectivityMinus: number[]
  asymmetry: number[]
}

// Optical constants vs. depth z as used by the calculation (after roughness), D-26.
// z = 0 is the substrate surface; z grows towards the ambient medium.
export interface ProfileSegment {
  start: number; end: number
  delta: number; beta: number; deltaMag: number; betaMag: number
}
export interface DepthProfile {
  segments?: ProfileSegment[] // actual engine slices; mock supplies its sampling intervals

  z: number[]
  delta: number[]
  beta: number[]
  deltaMag: number[]
  betaMag: number[]
}

// Curve from the actual best objective evaluation, not a separate redraw.
export interface FitDatasetPreview {
  datasetIndex: number
  scan: 'qz' | 'energy'
  beams: 'monochromatic' | 'dichroic'
  qz: number[]
  energy?: number[]
  reflectivityPlus: number[]
  reflectivityMinus: number[]
  asymmetry: number[]
}

export interface FitProgress {
  datasetPreview?: FitDatasetPreview
  iteration: number
  chi2: number
  values: number[] // current value of each fit parameter, same order as project.fit.parameters
}

export interface FitDatasetUpdate {
  index: number
  values: Partial<Pick<Project['datasets'][number], 'angularResolution' | 'intensityScale' | 'qzShift' | 'energyShift'>>
}

export interface FitResult {
  // Real fits report exactly which dataset fields were fitted. Absent for the mock.
  datasetUpdates?: FitDatasetUpdate[]
  project: Project // evaluated best snapshot; may include calculation context changed during a real fit
  values: number[] // best value of each fit parameter, same order as project.fit.parameters
  chi2: number
  iterations: number
  stopped: boolean // true if ended by Stop, false if converged or hit the iteration limit
}

export interface ComputeService {
  readonly providesFitPreviews?: boolean
  dielectricTensor(project: Project, query: TensorQuery): Promise<TensorPreview>
  databaseValues(project: Project, tables: OpticalTable[]): Promise<DatabaseValues>
  densityProfiles(project: Project): Promise<DensityProfiles>
  scatteringFactors(project: Project, query: ElementSpectrumQuery): Promise<LayerSpectrum>
  layerSpectrum(project: Project, query: LayerSpectrumQuery): Promise<LayerSpectrum>
  calcReflectivity(project: Project): Promise<ReflectivityCurve>
  calcEnergyScan(project: Project): Promise<EnergyScanCurve>
  calcEnergyAsymmetry(project: Project): Promise<EnergyAsymmetryCurve>
  calcAsymmetry(project: Project): Promise<AsymmetryCurve>
  materialToElements(project: Project): Promise<ElementConversion>
  segmentLayers(project: Project): Promise<Layer[]>
  depthProfile(project: Project): Promise<DepthProfile>
  // Dataset-error statistic. The real engine sums all fit-enabled datasets, as the legacy χ² action does.
  calcChi2(project: Project): Promise<number>
  startFit(project: Project, onProgress: (progress: FitProgress) => void): Promise<FitResult>
  // Stop all current work in the shared worker, including standalone calculations.
  stop(): void
  stopFit(): void
  dispose(): void
}

// Error raised for invalid input or unsupported features; the message is shown to the user.
export class ComputeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComputeError'
  }
}

// Cancellation is a normal user action, not an engine failure.
export class ComputeCancelled extends ComputeError {
  constructor(message = 'Stopped.') {
    super(message)
    this.name = 'ComputeCancelled'
  }
}
