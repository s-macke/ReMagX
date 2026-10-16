import type { Project } from './project'

// Current structural editors change these indexed collections. Dataset columns are
// immutable and shared across metadata edits; replacing/reordering them changes identity.
export function fitStructureChanged(before: Project, after: Project): boolean {
  return before.sample.mode !== after.sample.mode ||
    before.sample.layers.length !== after.sample.layers.length ||
    before.sample.depthProfileFunctions.length !== after.sample.depthProfileFunctions.length ||
    before.scripts.parameters.length !== after.scripts.parameters.length ||
    before.sample.elementProfiles.length !== after.sample.elementProfiles.length ||
    before.sample.elementProfiles.some((element, index) => element.element !== after.sample.elementProfiles[index].element || element.slabs.length !== after.sample.elementProfiles[index].slabs.length) ||
    before.activeDatasetIndex !== after.activeDatasetIndex ||
    before.datasets.length !== after.datasets.length ||
    before.datasets.some((dataset, index) => dataset.columns !== after.datasets[index].columns) ||
    before.fit.parameters.length !== after.fit.parameters.length ||
    before.fit.parameters.some((parameter, index) => {
      const other = after.fit.parameters[index]
      return parameter.target !== other.target || parameter.index !== other.index || parameter.elementIndex !== other.elementIndex
    })
}
