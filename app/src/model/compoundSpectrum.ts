import { storedOpticalState } from './storedOpticalState'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealBeforeCalculation } from './realCalculation'
import { refreshPartialCompoundOptics, type RealTableLookup, type SerialOpticalState } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'

// Compound spectrum handlers: local CScript constructor, then Filldb and
// StartScript for every table point. The local object never sets state.script.
export function visitCompoundSpectrum(project: Project, tables: OpticalTable[], energy: number[],
  lookup: RealTableLookup, visit: (current: Project, state: SerialOpticalState) => void, beforeCalculation?: RealBeforeCalculation) {
  let current = project
  let opticalState: SerialOpticalState = project.calculation.automaticOpticalConstants ? storedOpticalState(project)
    : { layers: project.sample.layers, dielectricTensors: project.sample.layers.map(() => null), cursors: new Map() }
  const refresh = () => {
    const refreshed = refreshPartialCompoundOptics(current, tables,
      HC_EV_ANGSTROM / (HC_EV_ANGSTROM / current.experiment.energy), lookup, opticalState.cursors, opticalState.dielectricTensors)
    opticalState = { ...opticalState, layers: refreshed.layers, dielectricTensors: refreshed.dielectricTensors,
      dielectricState: refreshed.updated.map((updated, index) => updated ? null : opticalState.dielectricState?.[index] ?? null) }
    current = { ...current, sample: { ...current.sample, layers: refreshed.layers } }
  }
  const runHook = () => {
    if (!current.scripts.enabled || !current.scripts.beforeCalculation.trim()) return
    if (!beforeCalculation) throw new Error('BeforeCalculation Lua execution is not available for this spectrum.')
    const result = beforeCalculation(current, opticalState, 0, 'temporary')
    current = result.project; opticalState = result.opticalState
  }
  if (current.calculation.automaticOpticalConstants) refresh()
  runHook()
  for (const value of energy) {
    current = { ...current, experiment: { ...current.experiment, energy: value } }
    refresh()
    runHook()
    visit(current, opticalState)
  }
}

export function evaluateCompoundSpectrum(project: Project, tables: OpticalTable[], energy: number[],
  lookup: RealTableLookup, read: (current: Project) => [number, number], beforeCalculation?: RealBeforeCalculation) {
  const first: number[] = [], second: number[] = []
  visitCompoundSpectrum(project, tables, energy, lookup, current => {
    const pair = read(current)
    if (!pair.every(Number.isFinite)) throw new Error('Real spectrum exceeds the supported numerical range.')
    first.push(pair[0]); second.push(pair[1])
  }, beforeCalculation)
  return { energy, first, second }
}
