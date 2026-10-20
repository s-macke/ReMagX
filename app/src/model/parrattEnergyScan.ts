import type { PrepareSegmentedStack } from './segmentedCompoundStack'
import type { SegmentationTensor } from './segmentedLayers'
import { copyLayerDepths } from './layerDepths'
import type { RealBeforeCalculation, ScriptSessionLifetime } from './realCalculation'
import type { OpticalTable } from '../import/tables'
import { packCompoundLayers, prepareCompoundLayers, prepareCompoundLayerIndices, type PreparedCompoundLayer } from './compoundLayers'
import type { Project } from './project'
import { prepareEnergyCoordinates } from './energyScanCoordinates'
import { prepareParrattQzRequest, type PreparedParrattQzRequest } from './parrattRequest'
import { postprocessParrattResult } from './parrattResult'
import { refreshPartialCompoundOptics, type RealTableLookup, type SerialOpticalState } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'

export interface PreparedEnergyScan extends Pick<PreparedParrattQzRequest, 'beam1' | 'beam2' | 'tensor' | 'analyzer' | 'magnetic' | 'mode'> {
  stacks: PreparedCompoundLayer[][]
  dielectricTensors?: (Float64Array | null)[][]
  preparedDielectricStates?: ((SegmentationTensor | null)[] | undefined)[]
  energy: number[]
  qz: number[]
  enabled: number[]
  // Calculation energy, angular width and matrix epsilon per point (Lua preparation).
  pointSettings?: [number, number, number][]
  angularWidth: number
  energyWidth: number
}
export type EnergyScanCalculator = (request: PreparedEnergyScan) => Float64Array

// CalcEScan refreshes constants even when automaticOpticalConstants is off, and
// calls CalculateResolution (exact angular convolution, independent of fast flag).
export function calculateCompoundEnergyScan(project: Project, tables: OpticalTable[], lookup: RealTableLookup,
  calculate: EnergyScanCalculator, mode: 'monochromatic' | 'dichroic',
  prepareTemplate: typeof prepareParrattQzRequest, previous?: SerialOpticalState, beforeCalculation?: RealBeforeCalculation, scriptLifetime: ScriptSessionLifetime = 'temporary', prepareStack?: PrepareSegmentedStack) {
  const width = project.experiment.resolution.energyFwhm
  if (!Number.isFinite(width) || width < 0) throw new Error('Energy resolution must be finite and nonnegative.')
  const coordinates = prepareEnergyCoordinates(project, tables)
  const scripted = !!(beforeCalculation && project.scripts.enabled && project.scripts.beforeCalculation.trim())
  let current = project
  let opticalState: SerialOpticalState = { layers: project.sample.layers, layerDepths: copyLayerDepths(project, previous?.layerDepths),
    dielectricTensors: previous?.dielectricTensors ?? project.sample.layers.map(() => null),
    scatteringTensors: previous?.scatteringTensors, dielectricState: previous?.dielectricState, cursors: new Map(previous?.cursors) }
  const runHook = (nestedSession: ScriptSessionLifetime = 'existing') => {
    if (!scripted) return
    const result = beforeCalculation!(current, opticalState, 0, nestedSession)
    current = result.project
    opticalState = result.opticalState
  }
  // A temporary CScript constructor executes once before the point loop.
  if (scriptLifetime === 'temporary') runHook('temporary')
  const local: Project = { ...current,
    calculation: { ...current.calculation, automaticOpticalConstants: false },
    scripts: scripted ? { ...current.scripts, enabled: false } : current.scripts,
    experiment: { ...current.experiment,
      qzScan: { ...current.experiment.qzScan, useDatasetPoints: false, points: 2, qzMin: 0, qzMax: 0 },
      resolution: { ...current.experiment.resolution, fastConvolution: false } } }
  // Validate unsupported settings even when every dataset point lies outside the tables.
  const template = prepareTemplate(local, mode, undefined, prepareStack && local.calculation.roughnessModel === 'segmentation' ? packCompoundLayers(local) : undefined)
  const stacks: PreparedCompoundLayer[][] = []
  const enabled: number[] = []
  const dielectricTensors: (Float64Array | null)[][] = []
  const preparedDielectricStates: ((SegmentationTensor | null)[] | undefined)[] = []
  const pointSettings: [number, number, number][] = []
  coordinates.energy.forEach(energy => {
    current = { ...current, experiment: { ...current.experiment, energy } }
    const cursors = opticalState.cursors
    const refreshed = refreshPartialCompoundOptics(current,
      tables, HC_EV_ANGSTROM / (HC_EV_ANGSTROM / energy), lookup, cursors, opticalState.dielectricTensors)
    opticalState = { layerDepths: opticalState.layerDepths?.slice(), scatteringTensors: opticalState.scatteringTensors, layers: refreshed.layers, dielectricTensors: refreshed.dielectricTensors,
      dielectricState: refreshed.updated.map((updated, index) => updated ? null : opticalState.dielectricState?.[index] ?? null), cursors }
    current = { ...current, sample: { ...current.sample, layers: refreshed.layers } }
    if (refreshed.rangeError) {
      stacks.push(template.layers)
      dielectricTensors.push(template.layers.map(() => null))
      preparedDielectricStates.push(undefined)
      enabled.push(0)
    } else {
      runHook()
      const segmented = prepareStack?.(current, opticalState)
      stacks.push(segmented?.layers ?? prepareCompoundLayers(current))
      preparedDielectricStates.push(segmented?.dielectricTensors)
      dielectricTensors.push(prepareCompoundLayerIndices(current).map(index => opticalState.dielectricTensors[index]))
      enabled.push(1)
    }
    // CalcDicEScan captures k0 before the hook; CalcEScan captures it afterwards.
    pointSettings.push([mode === 'dichroic' ? energy : current.experiment.energy,
      current.experiment.resolution.angularFwhm, current.calculation.epsilon])
  })
  const resolved = calculate({ stacks, dielectricTensors,
    ...(preparedDielectricStates.some(Boolean) ? { preparedDielectricStates } : {}), enabled, energy: coordinates.energy, qz: coordinates.qz,
    beam1: template.beam1, beam2: template.beam2, tensor: template.tensor, analyzer: template.analyzer,
    magnetic: template.magnetic, mode: template.mode, angularWidth: template.resolution.width, energyWidth: width,
    ...(scripted ? { pointSettings } : {}) })
  const result = postprocessParrattResult(current, coordinates.qz, resolved, mode, coordinates.energy)
  return { opticalState, finalEnergy: current.experiment.energy, ...(scripted ? { scriptedProject: current } : {}),
    qz: coordinates.qz, energy: coordinates.energy, reflectivity: result.reflectivityPlus,
    reflectivityPlus: result.reflectivityPlus, reflectivityMinus: result.reflectivityMinus, asymmetry: result.asymmetry }

}

export function calculateParrattEnergyScan(project: Project, tables: OpticalTable[], lookup: RealTableLookup,
  calculate: EnergyScanCalculator, mode: 'monochromatic' | 'dichroic' = 'monochromatic', previous?: SerialOpticalState, beforeCalculation?: RealBeforeCalculation, scriptLifetime: ScriptSessionLifetime = 'temporary', prepareStack?: PrepareSegmentedStack) {
  return calculateCompoundEnergyScan(project, tables, lookup, calculate, mode, prepareParrattQzRequest, previous, beforeCalculation, scriptLifetime, prepareStack)
}
