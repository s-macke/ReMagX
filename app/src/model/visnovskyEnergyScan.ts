import type { PrepareSegmentedStack } from './segmentedCompoundStack'
import type { RealBeforeCalculation, ScriptSessionLifetime } from './realCalculation'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealTableLookup, SerialOpticalState } from './refreshOpticalConstants'
import { calculateCompoundEnergyScan, type PreparedEnergyScan } from './parrattEnergyScan'
import { prepareCompoundQzRequest } from './parrattRequest'
import { prepareVisnovskyLayers, validateVisnovskyProject, type DielectricTensorCalculator,
  type PreparedVisnovskyQzRequest } from './visnovskyRequest'

export interface PreparedVisnovskyEnergyScan extends Omit<PreparedEnergyScan, 'stacks' | 'tensor' | 'magnetic' | 'dielectricTensors' | 'preparedDielectricStates'> {
  stacks: PreparedVisnovskyQzRequest['layers'][]
  epsilon: number
}
export type VisnovskyEnergyCalculator = (request: PreparedVisnovskyEnergyScan) => Float64Array

export function calculateVisnovskyEnergyScan(project: Project, tables: OpticalTable[], lookup: RealTableLookup,
  constructTensor: DielectricTensorCalculator, calculate: VisnovskyEnergyCalculator,
  mode: 'monochromatic' | 'dichroic' = 'monochromatic', previous?: SerialOpticalState, beforeCalculation?: RealBeforeCalculation, scriptLifetime: ScriptSessionLifetime = 'temporary', prepareStack?: PrepareSegmentedStack) {
  validateVisnovskyProject(project)
  return calculateCompoundEnergyScan(project, tables, lookup, prepared => {
    const { stacks, tensor, magnetic, dielectricTensors, preparedDielectricStates, ...scan } = prepared
    const matrixStacks = stacks.map((stack, index) => {
      if (scan.enabled[index]) return prepareVisnovskyLayers(stack, tensor, magnetic, constructTensor, preparedDielectricStates?.[index] ? undefined : dielectricTensors?.[index], preparedDielectricStates?.[index])
      // Native skips these stacks entirely. Supply finite storage without
      // constructing tensors from stale/out-of-range optical constants.
      return stack.map(() => ({ values: [0, 0, 1, ...Array<number>(19).fill(0)], anisotropic: 0 as const }))
    })
    return calculate({ ...scan, stacks: matrixStacks, epsilon: project.calculation.epsilon })
  }, mode, prepareCompoundQzRequest, previous, beforeCalculation, scriptLifetime, prepareStack)
}
