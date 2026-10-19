import { storedOpticalState } from './storedOpticalState'
import type { OpticalTable } from '../import/tables'
import { projectSchema, type Project } from './project'
import type { RealCalculationEngine } from './realCalculation'
import { refreshPartialCompoundOptics, type SerialOpticalState } from './refreshOpticalConstants'
import { refreshElementOptics } from './refreshElementOptics'
import { copyScatteringTensors } from './scatteringTensors'
import { copyScriptTensors } from './scriptTensors'
import { HC_EV_ANGSTROM } from './units'

export type ScriptProgram = 'Default' | 'BeforeCalculation'
export interface ScriptExecutionResult {
  project: Project
  opticalState: SerialOpticalState
  scriptMessages: string[]
}

// GUI GetState before ExecuteScript: Filldb in the active mode when automatic,
// otherwise FillTensors for BOTH stored films. No generated element stack here.
// GetState ignores Filldb's false return and retains each skipped entry.
export function prepareManualScript(original: Project, tables: OpticalTable[], engine: RealCalculationEngine) {
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
    opticalState.dielectricState = copyScriptTensors(project.sample.layers.map(layer => engine.dielectricTensor({
      layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag,
        layer.magnetization.gamma, layer.magnetization.phi], tensor, magnetic,
    })))
    opticalState.scatteringTensors = copyScatteringTensors(project.sample.elementProfiles.map(element => constructScattering({
      factors: [element.f1, element.f2, element.f1Mag, element.f2Mag], tensor, magnetic,
      gamma: project.calculation.magnetization.direction.gamma, phi: project.calculation.magnetization.direction.phi,
    })))
  }
  return { project, opticalState }
}


/** Convert a complete worker result into the native JSON project, atomically.
 * Typed-array worker storage must not leak into JSON or alias undo snapshots.
 */
export function applyScriptExecution(result: ScriptExecutionResult): Project {
  const project = result.project, state = result.opticalState
  if (state.layers.length !== project.sample.layers.length ||
    state.dielectricState?.length !== project.sample.layers.length ||
    state.scatteringTensors?.length !== project.sample.elementProfiles.length ||
    state.dielectricState.some(tensor => tensor === null)) {
    throw new Error('Script result has incomplete optical state.')
  }
  const dielectric = copyScriptTensors(state.dielectricState.map(tensor => {
    if (!tensor) throw new Error('Script result has incomplete optical state.')
    return tensor
  }))
  const scattering = copyScatteringTensors(state.scatteringTensors)
  return projectSchema.parse({ ...project, sample: { ...project.sample,
    layers: project.sample.layers.map((layer, index) => ({ ...layer,
      dielectricTensor: { values: Array.from(dielectric[index].values), anisotropic: dielectric[index].anisotropic } })),
    elementProfiles: project.sample.elementProfiles.map((element, index) => ({ ...element,
      scatteringTensor: Array.from(scattering[index]) })),
  } })
}
