import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import { prepareEnergyCoordinates } from './energyScanCoordinates'
import { prepareParrattQzRequest, type PreparedParrattQzRequest } from './parrattRequest'
import { postprocessParrattResult } from './parrattResult'
import { OpticalTableRangeError, refreshCompoundConstants, type RealTableLookup } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'

export type EnergyConvolution = (energies: number[], values: Float64Array, width: number) => Float64Array

// CalcEScan refreshes constants even when automaticOpticalConstants is off, and
// calls CalculateResolution (exact angular convolution, independent of fast flag).
export function calculateParrattEnergyScan(project: Project, tables: OpticalTable[], lookup: RealTableLookup,
  calculate: (request: PreparedParrattQzRequest) => Float64Array, convolve: EnergyConvolution) {
  const width = project.experiment.resolution.energyFwhm
  if (!Number.isFinite(width) || width < 0) throw new Error('Energy resolution must be finite and nonnegative.')
  const coordinates = prepareEnergyCoordinates(project, tables)
  const calculation = { ...project.calculation, automaticOpticalConstants: false }
  const local: Project = { ...project, calculation, experiment: { ...project.experiment,
    qzScan: { ...project.experiment.qzScan, useDatasetPoints: false, points: 2, qzMin: 0, qzMax: 0 },
    resolution: { ...project.experiment.resolution, fastConvolution: false } } }
  // Validate unsupported settings even when every dataset point lies outside the tables.
  prepareParrattQzRequest(local, 'monochromatic')
  for (const layer of project.sample.layers) {
    if (!tables.some(table => layer.opticalTable && table.name === layer.opticalTable && table.kind === 'db' && table.energy.length)) {
      throw new Error(`Missing optical table ${layer.opticalTable || '(unnamed)'}.db for energy scan.`)
    }
  }
  const cursors = new Map<OpticalTable, number>()
  const values = new Float64Array(coordinates.energy.length * 2)
  coordinates.energy.forEach((energy, index) => {
    values[index * 2] = 1 // Legacy initialization survives Filldb range failures.
    let layers: Project['sample']['layers']
    try {
      layers = refreshCompoundConstants(project, tables, HC_EV_ANGSTROM / (HC_EV_ANGSTROM / energy), lookup, cursors)
    } catch (error) {
      if (error instanceof OpticalTableRangeError) return
      throw error
    }
    const prepared = prepareParrattQzRequest({ ...local, sample: { ...project.sample, layers },
      experiment: { ...local.experiment, energy } }, 'monochromatic')
    const result = calculate({ ...prepared, qz: [coordinates.qz[index]] })
    if (result.length !== 2 || !result.every(Number.isFinite)) throw new Error('The real engine returned invalid energy-scan values.')
    values[index * 2] = result[0]
  })
  const resolved = width >= 1e-10 ? convolve(coordinates.energy, values, width) : values
  const result = postprocessParrattResult(project, coordinates.qz, resolved, 'monochromatic', coordinates.energy)
  return { energy: coordinates.energy, reflectivity: result.reflectivityPlus }
}
