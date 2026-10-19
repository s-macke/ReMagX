import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealCalculationEngine } from './realCalculation'
import { prepareProjectOptics } from './projectOptics'
import { refreshCompoundOptics } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'

// Unit1.cpp Button24Click: GetState, then unconditional SetOCStrict, before
// constructing the scan/Lua session. This gate is not part of CalcEScan itself
// and must not be repeated for internal fit/dataset calls.
export function prepareStandaloneEnergyScan(project: Project, tables: OpticalTable[], engine: RealCalculationEngine) {
  const initial = prepareProjectOptics(project, tables, engine)
  const refreshed = refreshCompoundOptics(initial.project, tables,
    HC_EV_ANGSTROM / (HC_EV_ANGSTROM / initial.project.experiment.energy), engine.lookup, initial.opticalState.cursors)
  return { project: { ...initial.project, sample: { ...initial.project.sample, layers: refreshed.layers } },
    opticalState: { ...initial.opticalState, ...refreshed,
      // Strict success means every primary layer was refreshed. Construct the
      // new scalar tensors (or read imported overrides) before the first hook.
      dielectricState: refreshed.layers.map(() => null) } }
}
