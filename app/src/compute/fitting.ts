// Fitting for the mock engine: maps fit parameters onto the project, defines the error function
// against the active dataset and drives the Nelder-Mead optimizer.

import type { FitParameter, Project } from '../model/project'
import { ComputeError } from './ComputeService'
import { beamWeights, convolveResolution, parratt } from './mockPhysics'

const layerTargets = {
  thickness: 'thickness',
  roughness: 'roughness',
  delta: 'delta',
  beta: 'beta',
  deltaMag: 'deltaMag',
  betaMag: 'betaMag',
} as const

export function isSupportedInMock(parameter: FitParameter): boolean {
  return (
    parameter.target in layerTargets ||
    parameter.target === 'intensityScale' ||
    parameter.target === 'qzShift' ||
    parameter.target === 'angularResolution'
  )
}

// Writes one parameter value into the project (mutates; callers pass a copy).
export function applyFitParameter(project: Project, parameter: FitParameter, value: number): void {
  const target = parameter.target
  if (target in layerTargets) {
    const layer = parameter.index === null ? undefined : project.sample.layers[parameter.index]
    if (!layer) throw new ComputeError(`Fit parameter "${target}" refers to a missing layer ${parameter.index}.`)
    layer[layerTargets[target as keyof typeof layerTargets]] = value
    return
  }
  if (target === 'angularResolution') {
    project.experiment.resolution.angularFwhm = value
    return
  }
  const dataset = project.activeDatasetIndex === null ? undefined : project.datasets[project.activeDatasetIndex]
  if (!dataset) throw new ComputeError(`Fit parameter "${target}" needs an active dataset.`)
  if (target === 'intensityScale') dataset.intensityScale = value
  else if (target === 'qzShift') dataset.qzShift = value
  else throw new ComputeError(`Fitting "${target}" is not available in the mock engine yet.`)
}

export function withParameters(project: Project, values: number[]): Project {
  const copy = structuredClone(project)
  project.fit.parameters.forEach((parameter, i) => applyFitParameter(copy, parameter, values[i]))
  return copy
}

// Error between simulation and the active dataset inside the fit window.
// log-chi2: mean squared difference of log10 reflectivities; lin-chi2: mean squared relative difference.
export function fitError(project: Project): number {
  const dataset = project.activeDatasetIndex === null ? undefined : project.datasets[project.activeDatasetIndex]
  const measured = dataset?.columns.reflectivity
  if (!dataset || !measured) throw new ComputeError('Fitting needs an active dataset with reflectivity values.')

  const window = project.fit.window
  const selected = dataset.columns.qz
    .map((qz, i) => ({ qz, r: measured[i] }))
    .filter(({ qz, r }) => qz >= window.qzMin && qz <= window.qzMax && r > 0)
  if (selected.length === 0) throw new ComputeError('No measured points with R > 0 inside the fit window.')

  const layers = project.sample.layers.map((l) => ({
    delta: l.delta,
    beta: l.beta,
    thickness: l.thickness,
    roughness: l.roughness,
  }))
  const qz = selected.map((p) => p.qz + dataset.qzShift)
  const simulated = convolveResolution(
    (q) => parratt(layers, q, dataset.energy || project.experiment.energy, beamWeights(dataset.polarization.beam1)),
    qz,
    project.experiment.resolution.angularFwhm,
  ).map((r) => (r + dataset.intensityOffset) * dataset.intensityScale)

  const log = project.fit.errorFunction === 'log-chi2'
  let sum = 0
  selected.forEach(({ r }, i) => {
    const s = Math.max(simulated[i], 1e-300)
    const d = log ? Math.log10(s) - Math.log10(r) : (s - r) / r
    sum += d * d
  })
  return sum / selected.length
}

// Small deterministic PRNG (mulberry32) so annealing runs are reproducible for a given seed.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) + 1) / 4294967297
  }
}

export function checkFitSetup(project: Project): void {
  if (project.fit.parameters.length === 0) throw new ComputeError('No fit parameters selected.')
  const unsupported = project.fit.parameters.filter((p) => !isSupportedInMock(p)).map((p) => p.target)
  if (unsupported.length > 0) {
    throw new ComputeError(`Not available in the mock engine yet: ${[...new Set(unsupported)].join(', ')}.`)
  }
}
