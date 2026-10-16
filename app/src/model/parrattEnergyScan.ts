import type { OpticalTable } from '../import/tables'
import { prepareCompoundLayers, prepareCompoundLayerIndices, type PreparedCompoundLayer } from './compoundLayers'
import type { Project } from './project'
import { prepareEnergyCoordinates } from './energyScanCoordinates'
import { prepareParrattQzRequest, type PreparedParrattQzRequest } from './parrattRequest'
import { postprocessParrattResult } from './parrattResult'
import { OpticalTableRangeError, refreshCompoundOptics, type RealTableLookup } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'

export interface PreparedEnergyScan extends Pick<PreparedParrattQzRequest, 'beam1' | 'beam2' | 'tensor' | 'analyzer' | 'magnetic' | 'mode'> {
  stacks: PreparedCompoundLayer[][]
  dielectricTensors?: (Float64Array | null)[][]
  energy: number[]
  qz: number[]
  enabled: number[]
  angularWidth: number
  energyWidth: number
}
export type EnergyScanCalculator = (request: PreparedEnergyScan) => Float64Array

// CalcEScan refreshes constants even when automaticOpticalConstants is off, and
// calls CalculateResolution (exact angular convolution, independent of fast flag).
export function calculateCompoundEnergyScan(project: Project, tables: OpticalTable[], lookup: RealTableLookup,
  calculate: EnergyScanCalculator, mode: 'monochromatic' | 'dichroic',
  prepareTemplate: typeof prepareParrattQzRequest) {
  const width = project.experiment.resolution.energyFwhm
  if (!Number.isFinite(width) || width < 0) throw new Error('Energy resolution must be finite and nonnegative.')
  const coordinates = prepareEnergyCoordinates(project, tables)
  const calculation = { ...project.calculation, automaticOpticalConstants: false }
  const local: Project = { ...project, calculation, experiment: { ...project.experiment,
    qzScan: { ...project.experiment.qzScan, useDatasetPoints: false, points: 2, qzMin: 0, qzMax: 0 },
    resolution: { ...project.experiment.resolution, fastConvolution: false } } }
  // Validate unsupported settings even when every dataset point lies outside the tables.
  const template = prepareTemplate(local, mode)
  for (const layer of project.sample.layers) {
    if (!tables.some(table => layer.opticalTable && table.name === layer.opticalTable && table.kind === 'db' && table.energy.length)) {
      throw new Error(`Missing optical table ${layer.opticalTable || '(unnamed)'}.db for energy scan.`)
    }
  }
  const cursors = new Map<OpticalTable, number>()
  const stacks: PreparedCompoundLayer[][] = []
  const enabled: number[] = []
  const dielectricTensors: (Float64Array | null)[][] = []
  coordinates.energy.forEach(energy => {
    let refreshed: ReturnType<typeof refreshCompoundOptics>
    try {
      refreshed = refreshCompoundOptics(project, tables, HC_EV_ANGSTROM / (HC_EV_ANGSTROM / energy), lookup, cursors)
    } catch (error) {
      if (error instanceof OpticalTableRangeError) {
        stacks.push(template.layers)
        dielectricTensors.push(template.layers.map(() => null))
        enabled.push(0)
        return
      }
      throw error
    }
    stacks.push(prepareCompoundLayers({ ...local, sample: { ...project.sample, layers: refreshed.layers } }))
    dielectricTensors.push(prepareCompoundLayerIndices(local).map(index => refreshed.dielectricTensors[index]))
    enabled.push(1)
  })
  const resolved = calculate({ stacks, dielectricTensors, enabled, energy: coordinates.energy, qz: coordinates.qz,
    beam1: template.beam1, beam2: template.beam2, tensor: template.tensor, analyzer: template.analyzer,
    magnetic: template.magnetic, mode: template.mode, angularWidth: template.resolution.width, energyWidth: width })
  const result = postprocessParrattResult(project, coordinates.qz, resolved, mode, coordinates.energy)
  return { energy: coordinates.energy, reflectivity: result.reflectivityPlus,
    reflectivityPlus: result.reflectivityPlus, reflectivityMinus: result.reflectivityMinus, asymmetry: result.asymmetry }
}

export function calculateParrattEnergyScan(project: Project, tables: OpticalTable[], lookup: RealTableLookup,
  calculate: EnergyScanCalculator, mode: 'monochromatic' | 'dichroic' = 'monochromatic') {
  return calculateCompoundEnergyScan(project, tables, lookup, calculate, mode, prepareParrattQzRequest)
}
