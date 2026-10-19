import type { RealBeforeCalculation, ScriptSessionLifetime } from './realCalculation'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import { prepareCompoundQzRequest, type PreparedParrattQzRequest } from './parrattRequest'
import { calculateCompoundEnergyScan, type PreparedEnergyScan } from './parrattEnergyScan'
import type { RealTableLookup, SerialOpticalState } from './refreshOpticalConstants'

export type PreparedZakQzRequest = Omit<PreparedParrattQzRequest, 'tensor'>
export type PreparedZakEnergyScan = Omit<PreparedEnergyScan, 'tensor' | 'dielectricTensors'>
export type ZakEnergyCalculator = (request: PreparedZakEnergyScan) => Float64Array

function prepareZakTemplate(project: Project, mode: 'monochromatic' | 'dichroic', coordinates?: readonly number[]) {
  if (project.calculation.algorithm !== 'zak') throw new Error('This real-engine path requires the Zak algorithm.')
  return prepareCompoundQzRequest(project, mode, coordinates)
}

// CZak reads scalar optical constants and directions; it does not consume
// epsilon, tensorContribution or imported dielectric tensors.
export function prepareZakQzRequest(project: Project, mode: 'monochromatic' | 'dichroic', coordinates?: readonly number[]): PreparedZakQzRequest {
  const { tensor: _tensor, ...request } = prepareZakTemplate(project, mode, coordinates)
  return request
}

export function calculateZakEnergyScan(project: Project, tables: OpticalTable[], lookup: RealTableLookup,
  calculate: ZakEnergyCalculator, mode: 'monochromatic' | 'dichroic' = 'monochromatic', previous?: SerialOpticalState, beforeCalculation?: RealBeforeCalculation, scriptLifetime: ScriptSessionLifetime = 'temporary') {
  return calculateCompoundEnergyScan(project, tables, lookup, prepared => {
    const { tensor: _tensor, dielectricTensors: _dielectricTensors, ...request } = prepared
    return calculate(request)
  }, mode, prepareZakTemplate, previous, beforeCalculation, scriptLifetime)
}
