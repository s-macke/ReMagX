import type { Project } from './project'
import type { SerialOpticalState } from './refreshOpticalConstants'
import { copyScriptTensors } from './scriptTensors'
import { copyScatteringTensors } from './scatteringTensors'

/** Copy the stored film before GetState refresh. Missing legacy tensor storage
 * starts at zero; callers performing FillTensors must replace both tensor sets.
 */
export function storedOpticalState(project: Project): SerialOpticalState {
  const dielectricState = copyScriptTensors(project.sample.layers.map(layer => layer.dielectricTensor
    ? { values: new Float64Array(layer.dielectricTensor.values), anisotropic: layer.dielectricTensor.anisotropic }
    : { values: new Float64Array(18), anisotropic: false }))
  return {
    layers: project.sample.layers, cursors: new Map(), dielectricState,
    dielectricTensors: dielectricState.map(tensor => tensor.anisotropic ? tensor.values.slice() : null),
    scatteringTensors: copyScatteringTensors(project.sample.elementProfiles.map(element =>
      element.scatteringTensor ? new Float64Array(element.scatteringTensor) : new Float64Array(18))),
  }
}
