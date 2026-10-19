import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealCalculationEngine } from './realCalculation'
import { storedOpticalState } from './storedOpticalState'
import { refreshCompoundOptics, refreshPartialCompoundOptics, type RealTableLookup, type SerialOpticalState } from './refreshOpticalConstants'
import { refreshElementOptics } from './refreshElementOptics'
import { copyScatteringTensors } from './scatteringTensors'
import { copyScriptTensors } from './scriptTensors'
import { HC_EV_ANGSTROM } from './units'

// GUI GetState: Filldb in the active mode when automatic,
// otherwise FillTensors for BOTH stored films. No generated element stack here.
// GetState ignores Filldb's false return and retains each skipped entry.
export function prepareProjectOptics(original: Project, tables: OpticalTable[], engine: RealCalculationEngine) {
  let project = structuredClone(original)
  const opticalState = storedOpticalState(project)
  const constructScattering = (request: Parameters<NonNullable<RealCalculationEngine['scatteringTensor']>>[0]) => {
    if (!engine.scatteringTensor) throw new Error('Native element scattering tensors are unavailable.')
    return engine.scatteringTensor(request)
  }
  if (project.calculation.automaticOpticalConstants) {
    const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy)
    if (project.sample.mode === 'element') {
      const refreshed = refreshElementOptics(project, tables, energy, engine.lookup, constructScattering, opticalState.cursors, opticalState.scatteringTensors)
      project = { ...project, sample: { ...project.sample, elementProfiles: refreshed.elementProfiles } }
      opticalState.scatteringTensors = refreshed.scatteringTensors
    } else {
      const refreshed = refreshPartialCompoundOptics(project, tables, energy, engine.lookup, opticalState.cursors, opticalState.dielectricTensors)
      project = { ...project, sample: { ...project.sample, layers: refreshed.layers } }
      opticalState.layers = refreshed.layers
      opticalState.dielectricTensors = refreshed.dielectricTensors
      // The shared Lua factory constructs updated scalar tensors; skipped
      // entries retain stored tensors (zero by default) and imported .e overrides retain their full tensor.
      opticalState.dielectricState = refreshed.updated.map((updated, index) => updated ? null : opticalState.dielectricState![index])
    }
  } else {
    const tensor = project.calculation.tensorContribution === 'tetragonal' ? 1 : 0
    const magnetic = project.calculation.magnetization.mode === 'none' ? 0 : 1
    const dielectricState = copyScriptTensors(project.sample.layers.map(layer => engine.dielectricTensor({
      layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag,
        layer.magnetization.gamma, layer.magnetization.phi], tensor, magnetic,
    })))
    opticalState.dielectricState = dielectricState
    opticalState.dielectricTensors = dielectricState.map(tensor => tensor.anisotropic ? tensor.values.slice() : null)
    opticalState.scatteringTensors = copyScatteringTensors(project.sample.elementProfiles.map(element => constructScattering({
      factors: [element.f1, element.f2, element.f1Mag, element.f2Mag], tensor, magnetic,
      gamma: project.calculation.magnetization.direction.gamma, phi: project.calculation.magnetization.direction.phi,
    })))
  }
  return { project, opticalState }
}



// SetOCStrict after GetState. Keep shared lookup cursors across repeated calls.
export function refreshStrictProjectOptics(initial: { project: Project; opticalState: SerialOpticalState },
  tables: OpticalTable[], lookup: RealTableLookup) {
  const refreshed = refreshCompoundOptics(initial.project, tables,
    HC_EV_ANGSTROM / (HC_EV_ANGSTROM / initial.project.experiment.energy), lookup, initial.opticalState.cursors)
  return { project: { ...initial.project, sample: { ...initial.project.sample, layers: refreshed.layers } },
    opticalState: { ...initial.opticalState, ...refreshed,
      // Strict success refreshed every primary layer. The hook constructs new
      // scalar tensors or reads imported overrides before execution.
      dielectricState: refreshed.layers.map(() => null) } }
}
