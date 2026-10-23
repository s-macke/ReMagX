import type { Project } from './project'
import { writeFitTarget } from './fitTargets'

// Applies one candidate to the current fit state, in parameter-list order.
// The caller supplies the legacy current dataset context; this is not necessarily
// the dataset selected in the UI once a multi-dataset evaluation has advanced it.
// This maps values only: it does not construct a simplex or evaluate regularization.
export function applyRealFitParameters(project: Project, candidate: readonly number[] | Float64Array): { project: Project; values: number[] } {
  const parameters = project.fit.parameters
  if (candidate.length !== parameters.length) throw new Error('Fit candidate and parameter counts differ.')
  const values = parameters.map((parameter, index) => {
    const value = candidate[index]
    if (!Number.isFinite(value) || !Number.isFinite(parameter.lowerBound) || !Number.isFinite(parameter.upperBound) ||
        parameter.lowerBound > parameter.upperBound) throw new Error(`Invalid value or bounds for fit parameter ${index + 1}.`)
    // Legacy VerifyVars with bounds checking: lower comparison, then upper.
    let bounded = value
    if (bounded < parameter.lowerBound) bounded = parameter.lowerBound
    if (bounded > parameter.upperBound) bounded = parameter.upperBound
    return bounded
  })
  // Measurements are immutable and need not be duplicated for every objective call.
  const result: Project = { ...structuredClone({ ...project, datasets: [] }),
    datasets: project.datasets.map(dataset => ({ ...dataset })) }
  parameters.forEach((parameter, index) => {
    const value = values[index]
    switch (parameter.target) {
      case 'angularResolution':
        result.experiment.resolution.angularFwhm = value
        for (const dataset of result.datasets) if (dataset.active) dataset.angularResolution = value
        break
      case 'intensityScale':
        for (const dataset of result.datasets) if (dataset.active) dataset.intensityScale = value
        break
      case 'scriptParameter':
        // CStateHandler::ImplementFitVariable explicitly skips missing script
        // slots. Keep the bounded fit row for the optimizer and Q penalty.
        writeFitTarget(result, parameter, value)
        break
      default:
        if (!writeFitTarget(result, parameter, value)) {
          throw new Error(`Fit parameter ${index + 1} (${parameter.target}) has no supported target in this project.`)
        }
    }
    result.fit.parameters[index].value = value
  })
  return { project: result, values }
}
