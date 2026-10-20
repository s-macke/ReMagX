import { prepareRealSegmentedStack } from './segmentedCompoundStack'
import type { SegmentationEngine } from './segmentedLayers'
import type { MagneticProfileEngine } from './segmentedMagneticProfiles'
import { copyLayerDepths } from './layerDepths'
import { storedOpticalState } from './storedOpticalState'
import type { ScatteringTensorCalculator } from './scatteringTensors'
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
import type { FourierCalculator } from './datasetPostprocessing'

export type RealQzCalculator = (request: PreparedParrattQzRequest) => Float64Array

export interface RealCalculationEngine {
  // Explicit samples only until a production error-function policy is approved.
  segmentation?: SegmentationEngine & MagneticProfileEngine & { errorSamples: readonly number[] }
  fourier?: FourierCalculator
  convolveFastQz?(qz: number[], values: Float64Array, width: number): Float64Array
  gaussLorentzianImag?(energy: number, center: number, area: number, width: number, mixingPercent: number): number
  gaussLorentzianReal?(energy: number, center: number, area: number, width: number, mixingPercent: number): number
  calculate: RealQzCalculator
  lookup: RealTableLookup
  energyScan: EnergyScanCalculator
  zakQz: (request: PreparedZakQzRequest) => Float64Array
  zakEnergy: ZakEnergyCalculator
  matrixEnergy: VisnovskyEnergyCalculator
  scatteringTensor?: ScatteringTensorCalculator
  dielectricTensor: DielectricTensorCalculator
  matrixQz: (request: PreparedVisnovskyQzRequest) => Float64Array
}

export type RealCurve = ReturnType<typeof postprocessParrattResult> & { axis?: 'depth'; energy?: number[]; opticalState: SerialOpticalState; finalEnergy: number; scriptedProject?: Project }

export type ScriptSessionLifetime = 'temporary' | 'existing'

// nestedSession describes state.script at hook entry: constructor hooks run
// before assignment, so nested calculations need fresh temporary sessions.
export type RealBeforeCalculation = (project: Project, opticalState: SerialOpticalState, renewOpticalConstants?: number, nestedSession?: ScriptSessionLifetime) => {
  project: Project; opticalState: SerialOpticalState
}

// Shared calculation preparation for plots and dataset objectives.
export function calculateRealCurve(original: Project, tables: OpticalTable[], engine: RealCalculationEngine,
  scan: 'qz' | 'energy', mode: 'monochromatic' | 'dichroic', previous?: SerialOpticalState, beforeCalculation?: RealBeforeCalculation, scriptLifetime: ScriptSessionLifetime = 'temporary'): RealCurve {
  if (scan === 'energy') {
    if (original.calculation.roughnessModel === 'segmentation' && !engine.segmentation) throw new Error('Adaptive segmentation requires an explicit error-function lookup and numerical engine.')
    const prepareStack = (project: Project, state: SerialOpticalState) => prepareRealSegmentedStack(project, state, engine)
    return original.calculation.algorithm === 'matrix'
      ? calculateVisnovskyEnergyScan(original, tables, engine.lookup, engine.dielectricTensor, engine.matrixEnergy, mode, previous, beforeCalculation, scriptLifetime, prepareStack)
      : original.calculation.algorithm === 'zak'
        ? calculateZakEnergyScan(original, tables, engine.lookup, engine.zakEnergy, mode, previous, beforeCalculation, scriptLifetime, prepareStack)
        : calculateParrattEnergyScan(original, tables, engine.lookup, engine.energyScan, mode, previous, beforeCalculation, scriptLifetime, prepareStack)
  }
  // A fresh automatic qz request starts from stored film tensors. Serial
  // callers supply their newer calculation state, which takes precedence.
  previous ??= original.calculation.automaticOpticalConstants ? storedOpticalState(original) : undefined
  const layerDepths = copyLayerDepths(original, previous?.layerDepths)
  let scriptedProject: Project | undefined
  let project = original
  let cursors = new Map(previous?.cursors)
  let scatteringTensors = previous?.scatteringTensors
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
    // Packing suppresses a second refresh, but nested calls must still see the
    // original automatic-constants setting in their shared project state.
    const hookProject = { ...project, calculation: { ...project.calculation,
      automaticOpticalConstants: original.calculation.automaticOpticalConstants } }
    const scripted = beforeCalculation(hookProject, { layers: project.sample.layers, layerDepths: layerDepths.slice(), dielectricTensors, dielectricState, scatteringTensors, cursors }, 0, scriptLifetime)
    scriptedProject = { ...scripted.project, calculation: { ...scripted.project.calculation,
      automaticOpticalConstants: original.calculation.automaticOpticalConstants } }
    project = { ...scripted.project, scripts: { ...scripted.project.scripts, enabled: false },
      calculation: { ...scripted.project.calculation, automaticOpticalConstants: false } }
    dielectricTensors = scripted.opticalState.dielectricTensors
    scatteringTensors = scripted.opticalState.scatteringTensors
    dielectricState = scripted.opticalState.dielectricState
    cursors = scripted.opticalState.cursors
  }
  let qz: number[], values: Float64Array
  const transform = project.calculation.postProcessing.fourierTransform
  if (transform && (mode !== 'monochromatic' || !engine.fourier)) throw new Error('Fourier processing is not available for this real-engine request.')
  // Fourier operates on the completed curve, never on individual kernel calls.
  const packedProject = transform ? { ...project, calculation: { ...project.calculation,
    postProcessing: { ...project.calculation.postProcessing, fourierTransform: false } } } : project
  const segmented = prepareRealSegmentedStack(packedProject, { layers: project.sample.layers,
    layerDepths, dielectricTensors, dielectricState, scatteringTensors, cursors }, engine)
  if (project.calculation.algorithm === 'matrix') {
    const request = prepareVisnovskyQzRequest(packedProject, mode, engine.dielectricTensor, dielectricTensors, undefined, segmented)
    qz = request.qz
    values = engine.matrixQz(request)
  } else if (project.calculation.algorithm === 'zak') {
    const request = prepareZakQzRequest(packedProject, mode, undefined, segmented?.layers)
    qz = request.qz
    values = engine.zakQz(request)
  } else {
    const request = prepareParrattQzRequest(packedProject, mode, undefined, segmented?.layers)
    qz = request.qz
    values = engine.calculate(request)
  }
  const result = postprocessParrattResult(project, qz, values, mode, undefined, engine.fourier)
  return { ...result, ...(transform ? { axis: 'depth' as const } : {}), opticalState: { layers: project.sample.layers, layerDepths: layerDepths.slice(), dielectricTensors, dielectricState, scatteringTensors, cursors },
    finalEnergy: project.experiment.energy, ...(scriptedProject ? { scriptedProject } : {}) }
}
