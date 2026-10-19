import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealCalculationEngine } from './realCalculation'
import { prepareProjectOptics, refreshStrictProjectOptics } from './projectOptics'

// Unit1.cpp Button3Click: GetState, then SetOCStrict only for automatic
// constants. CalcReflectivityFilm/CalcAsymmetry still perform their own partial
// refresh afterwards; internal fit/dataset calls must not repeat this GUI gate.
export function prepareStandaloneQz(project: Project, tables: OpticalTable[], engine: RealCalculationEngine) {
  const prepared = prepareProjectOptics(project, tables, engine)
  return project.calculation.automaticOpticalConstants
    ? refreshStrictProjectOptics(prepared, tables, engine.lookup) : prepared
}
