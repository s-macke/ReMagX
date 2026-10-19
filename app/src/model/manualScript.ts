import { projectSchema, type Project } from './project'
import type { SerialOpticalState } from './refreshOpticalConstants'
import { copyScatteringTensors } from './scatteringTensors'
import { copyScriptTensors } from './scriptTensors'

export type ScriptProgram = 'Default' | 'BeforeCalculation'
export interface ScriptExecutionResult {
  project: Project
  opticalState: SerialOpticalState
  scriptMessages: string[]
}

export { prepareProjectOptics as prepareManualScript } from './projectOptics'

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
