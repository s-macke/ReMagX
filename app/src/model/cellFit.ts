import { createFitParameter, readFitTarget } from './fitTargets'
import type { FitParameter, Project } from './project'

export type CellFitTarget = Pick<FitParameter, 'target' | 'index' | 'elementIndex'>
const matches = (parameter: CellFitTarget, cell: CellFitTarget) => parameter.target === cell.target && parameter.index === cell.index && parameter.elementIndex === cell.elementIndex

export function cellIsFitted(project: Project, cell: CellFitTarget): boolean {
  return project.fit.parameters.some(parameter => matches(parameter, cell))
}

// Use the same initial values/bounds as Add Parameter in the Fit tab. Turning a cell
// off removes matching entries only; other parameters and measurements stay untouched.
export function toggleCellFit(project: Project, cell: CellFitTarget): Project {
  if (cellIsFitted(project, cell)) return { ...project, fit: { ...project.fit, parameters: project.fit.parameters.filter(parameter => !matches(parameter, cell)) } }
  const parameter = createFitParameter(project, cell.target, cell.index, cell.elementIndex)
  if (readFitTarget(project, parameter) === undefined) return project
  return { ...project, fit: { ...project.fit, parameters: [...project.fit.parameters, parameter] } }
}
