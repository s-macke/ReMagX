import { copyLayerDepths } from './layerDepths'
import { storedOpticalState } from './storedOpticalState'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealBeforeCalculation } from './realCalculation'
import type { RealTableLookup, SerialOpticalState } from './refreshOpticalConstants'
import { refreshElementOptics } from './refreshElementOptics'
import { copyScatteringTensors, type ScatteringTensorCalculator } from './scatteringTensors'
import { HC_EV_ANGSTROM } from './units'

// Element spectrum handlers retain the stored compound film separately from
// element slabs. Only FillLayers later creates a separate generated stack.
export function evaluateElementSpectrum(project: Project, tables: OpticalTable[], energy: number[], lookup: RealTableLookup,
  construct: ScatteringTensorCalculator, read: (current: Project, energy: number) => [number, number], beforeCalculation?: RealBeforeCalculation) {
  let current = project
  let state: SerialOpticalState = project.calculation.automaticOpticalConstants ? storedOpticalState(project)
    : { layers: project.sample.layers, layerDepths: copyLayerDepths(project), dielectricTensors: project.sample.layers.map(() => null), cursors: new Map() }
  const refresh = () => {
    const refreshed = refreshElementOptics(current, tables, HC_EV_ANGSTROM / (HC_EV_ANGSTROM / current.experiment.energy),
      lookup, construct, state.cursors, state.scatteringTensors)
    current = { ...current, sample: { ...current.sample, elementProfiles: refreshed.elementProfiles } }
    state = { ...state, scatteringTensors: refreshed.scatteringTensors }
  }
  if (project.calculation.automaticOpticalConstants) refresh()
  else state.scatteringTensors = copyScatteringTensors(project.sample.elementProfiles.map(element => construct({
    factors: [element.f1, element.f2, element.f1Mag, element.f2Mag],
    gamma: project.calculation.magnetization.direction.gamma, phi: project.calculation.magnetization.direction.phi,
    tensor: project.calculation.tensorContribution === 'tetragonal' ? 1 : 0,
    magnetic: project.calculation.magnetization.mode === 'none' ? 0 : 1,
  })))
  const runHook = () => {
    if (!current.scripts.enabled || !current.scripts.beforeCalculation.trim()) return
    if (!beforeCalculation) throw new Error('BeforeCalculation Lua execution is unavailable for this element spectrum.')
    const result = beforeCalculation(current, state, 0, 'temporary')
    current = result.project; state = result.opticalState
  }
  runHook()
  const first: number[] = [], second: number[] = []
  for (const value of energy) {
    current = { ...current, experiment: { ...current.experiment, energy: value } }
    refresh(); runHook()
    const pair = read(current, value)
    if (!pair.every(Number.isFinite)) throw new Error('Real spectrum exceeds the supported numerical range.')
    first.push(pair[0]); second.push(pair[1])
  }
  return { energy, first, second }
}
