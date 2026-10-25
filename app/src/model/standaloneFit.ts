import { assertSupportedFitTargets } from './fitCapabilities'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealCalculationEngine } from './realCalculation'
import { prepareProjectOptics, refreshStrictProjectOptics } from './projectOptics'

// Unit1.cpp FitStartButtonClick: GetState, active dataset validation, then
// separate strict refreshes for automatic constants and for any energy dataset.
// Both checks run when both conditions hold; preserve their shared cursors.
export function prepareStandaloneFit(project: Project, tables: OpticalTable[], engine: RealCalculationEngine) {
  assertSupportedFitTargets(project)
  let prepared = prepareProjectOptics(project, tables, engine)
  const active = prepared.project.datasets.filter(dataset => dataset.active)
  if (!active.length) throw new Error('Select at least one dataset for fitting.')
  if (active.some(dataset => dataset.columns.qz.length === 0)) throw new Error('An active fit dataset contains no data.')
  if (project.calculation.automaticOpticalConstants) prepared = refreshStrictProjectOptics(prepared, tables, engine)
  if (active.some(dataset => (dataset.columns.energy?.length ?? 0) > 0)) prepared = refreshStrictProjectOptics(prepared, tables, engine)
  return prepared
}
