import type { FitResult } from '../compute/ComputeService'
import type { Project } from './project'
import { applyFitValues } from './fitTargets'
import { fitStructureChanged } from './fitStructure'

// Called inside an epoch-checked reducer event. Keep this guard as well for
// callers outside React: a changed indexed collection makes old results unsafe.
export function mergeFitResult(current: Project, source: Project, fitted: FitResult): Project {
  if (fitStructureChanged(source, current)) return current
  if (fitted.values.length !== source.fit.parameters.length || !fitted.values.every(Number.isFinite)) {
    throw new Error('Invalid parameter values in fit result.')
  }
  const result = applyFitValues(current, source.fit.parameters, fitted.values)
  result.fit.parameters.forEach((parameter, index) => { parameter.value = fitted.values[index] })
  if (fitted.datasetUpdates !== undefined) {
    // The real mapper may fit every enabled dataset, or a shift target that
    // changes with the legacy current-dataset context. Do not infer either from
    // the current UI selection or copy the worker's entire mutated project.
    result.datasets = current.datasets.map(dataset => ({ ...dataset }))
    for (const update of fitted.datasetUpdates) {
      const dataset = result.datasets[update.index]
      if (!dataset) throw new Error('Invalid dataset index in fit result.')
      for (const field of ['angularResolution', 'intensityScale', 'qzShift', 'energyShift'] as const) {
        const value = update.values[field]
        if (value !== undefined) {
          if (!Number.isFinite(value)) throw new Error('Invalid dataset value in fit result.')
          dataset[field] = value
        }
      }
    }
  }
  return result
}
