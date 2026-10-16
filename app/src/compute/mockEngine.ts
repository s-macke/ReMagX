// Worker-side request handling for the mock engine. Kept free of worker globals so it can be
// tested directly; worker.ts only wires it to postMessage.

import { mockTensor } from './mockTensor'
import { mockDatabaseValues } from './mockDatabaseValues'
import { mockDensityProfiles } from './mockDensityProfiles'
import { mockLayerSpectrum, mockScatteringFactors } from './mockSpectrum'
import type { Project } from '../model/project'
import { ComputeError, type FitResult } from './ComputeService'
import { checkFitSetup, fitError, seededRandom, withParameters } from './fitting'
import { calcAsymmetry, calcEnergyScan, calcReflectivity, depthProfile } from './mockPhysics'
import { nelderMead } from './nelderMead'
import type { WorkerRequest, WorkerResponse } from './protocol'

const MAX_FIT_ITERATIONS = 2000
const FIT_TOLERANCE = 1e-10

// Lets queued messages (such as stopFit) reach the handler during a long fit.
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export function createRequestHandler(post: (response: WorkerResponse) => void) {
  let stopRequested = false

  async function runFit(id: number, project: Project): Promise<FitResult> {
    checkFitSetup(project)
    const parameters = project.fit.parameters
    const objective = (values: number[]) => fitError(withParameters(project, values))
    const annealing =
      project.fit.algorithm === 'simplex-annealing'
        ? { ...project.fit.annealing, random: seededRandom(project.fit.evolution.randomSeed) }
        : undefined

    const optimizer = nelderMead(objective, {
      start: parameters.map((p) => p.value),
      steps: parameters.map((p) => p.step),
      lowerBounds: parameters.map((p) => p.lowerBound),
      upperBounds: parameters.map((p) => p.upperBound),
      maxIterations: MAX_FIT_ITERATIONS,
      tolerance: FIT_TOLERANCE,
      annealing,
    })

    stopRequested = false
    let state = optimizer.next()
    while (!state.done && !stopRequested) {
      post({ id, type: 'fitProgress', progress: { iteration: state.value.iteration, chi2: state.value.bestValue, values: state.value.best } })
      await yieldToEventLoop()
      if (!stopRequested) state = optimizer.next()
    }
    const best = state.value
    return {
      project: withParameters(project, best.best),
      values: best.best,
      chi2: best.bestValue,
      iterations: best.iteration,
      stopped: stopRequested,
    }
  }

  return async function handle(request: WorkerRequest): Promise<void> {
    if (request.kind === 'stopFit') {
      stopRequested = true
      return
    }
    const { id, project } = request
    try {
      let result
      switch (request.kind) {
        case 'scatteringFactors':
          result = mockScatteringFactors(project, request.spectrum)
          break
        case 'layerSpectrum':
          result = mockLayerSpectrum(project, request.spectrum)
          break
        case 'reflectivity':
          result = calcReflectivity(project)
          break
        case 'energyScan':
          result = calcEnergyScan(project)
          break
        case 'asymmetry':
          result = calcAsymmetry(project)
          break
        case 'dielectricTensor':
          result = mockTensor(project, request.spectrum)
          break
        case 'databaseValues':
          result = mockDatabaseValues(project, request.spectrum.tables)
          break
        case 'densityProfiles':
          result = mockDensityProfiles(project)
          break
        case 'depthProfile':
          result = depthProfile(project)
          break
        case 'chi2':
          result = fitError(project)
          break
        case 'fit':
          result = await runFit(id, project)
          break
      }
      post({ id, type: 'result', result })
    } catch (error) {
      const message =
        error instanceof ComputeError ? error.message : `Internal error in the compute engine: ${String(error)}`
      post({ id, type: 'error', message })
    }
  }
}
