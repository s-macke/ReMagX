import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealCalculationEngine } from './realCalculation'
import { prepareProjectOptics, refreshStrictProjectOptics } from './projectOptics'

// Unit1.cpp Button24Click: GetState, then unconditional SetOCStrict, before
// constructing the scan/Lua session. This gate is not part of CalcEScan itself
// and must not be repeated for internal fit/dataset calls.
export function prepareStandaloneEnergyScan(project: Project, tables: OpticalTable[], engine: RealCalculationEngine) {
  return refreshStrictProjectOptics(prepareProjectOptics(project, tables, engine), tables, engine)
}
