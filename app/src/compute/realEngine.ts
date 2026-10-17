import { createBeforeCalculation } from './lua/beforeCalculation'
import type { LuaSession } from './lua/runtime'
import { realTensor } from '../model/realTensor'
import { realLayerSpectrum, realScatteringFactors } from '../model/realSpectrum'
import { realDatabaseValues } from '../model/realDatabaseValues'
import { runRealFit, type RealMinimizer } from '../model/realFit'
import { calculateRealCurve, type RealCalculationEngine } from '../model/realCalculation'
import { calculateProjectDatasetError, type FitErrorCalculator } from '../model/projectDatasetError'
import type { WorkerRequest, WorkerResponse } from './protocol'
export type { RealQzCalculator } from '../model/realCalculation'
export interface RealEngine extends RealCalculationEngine { fitError: FitErrorCalculator; minimize?: RealMinimizer }

// Uses the existing worker protocol. Unported operations never fall back to the mock.
export function createRealRequestHandler(send: (response: WorkerResponse) => void, load: () => Promise<RealEngine>, createLuaSession?: () => Promise<LuaSession>) {
  let calculator: Promise<RealEngine> | null = null
  return async (message: WorkerRequest): Promise<void> => {
    if (message.kind === 'stopFit') return // Standalone Stop terminates this worker through WorkerComputeService.
    try {
      if (message.kind !== 'reflectivity' && message.kind !== 'asymmetry' && message.kind !== 'energyScan' && message.kind !== 'energyAsymmetry' && message.kind !== 'chi2' && message.kind !== 'fit' && message.kind !== 'databaseValues' && message.kind !== 'layerSpectrum' && message.kind !== 'scatteringFactors' && message.kind !== 'dielectricTensor') {
        throw new Error(`The real engine does not support ${message.kind} yet.`)
      }
      calculator ??= load().catch(error => { calculator = null; throw error })
      const engine = await calculator
      if (message.kind === 'dielectricTensor') {
        send({ id: message.id, type: 'result', result: realTensor(message.project, message.spectrum, engine.lookup, engine.dielectricTensor) })
        return
      }
      if (message.kind === 'layerSpectrum' || message.kind === 'scatteringFactors') {
        const result = message.kind === 'layerSpectrum' ? realLayerSpectrum(message.project, message.spectrum, engine.lookup)
          : realScatteringFactors(message.project, message.spectrum, engine.lookup)
        send({ id: message.id, type: 'result', result })
        return
      }
      if (message.kind === 'databaseValues') {
        send({ id: message.id, type: 'result', result: realDatabaseValues(message.project, message.spectrum.tables, engine.lookup) })
        return
      }
      if (message.kind === 'fit') {
        if (!engine.minimize) throw new Error('The real optimizer is unavailable.')
        const result = runRealFit(message.project, message.tables ?? [], engine, engine.minimize,
          progress => send({ id: message.id, type: 'fitProgress', progress }))
        send({ id: message.id, type: 'result', result })
        return
      }
      if (message.kind === 'chi2') {
        send({ id: message.id, type: 'result', result: calculateProjectDatasetError(message.project, message.tables ?? [], engine) })
        return
      }
      const energy = message.kind === 'energyScan' || message.kind === 'energyAsymmetry'
      const mode = message.kind === 'reflectivity' || message.kind === 'energyScan' ? 'monochromatic' : 'dichroic'
      const hasScript = message.project.scripts.enabled && message.project.scripts.beforeCalculation.trim()
      const session = !energy && hasScript && createLuaSession ? await createLuaSession() : undefined
      const scriptMessages: string[] = []
      let result
      try {
        const hook = session ? createBeforeCalculation(session, engine, message.tables ?? [], message => scriptMessages.push(message)) : undefined
        result = calculateRealCurve(message.project, message.tables ?? [], engine, energy ? 'energy' : 'qz', mode, undefined, hook)
      } finally { session?.close() }
      if (energy) {
        if (!result.energy) throw new Error('Missing energy-scan coordinates.')
        send({ id: message.id, type: 'result', result: message.kind === 'energyScan'
          ? { energy: result.energy, reflectivity: result.reflectivityPlus }
          : { energy: result.energy, reflectivityPlus: result.reflectivityPlus, reflectivityMinus: result.reflectivityMinus, asymmetry: result.asymmetry } })
      } else {
        send({ id: message.id, type: 'result', result: message.kind === 'reflectivity'
          ? { qz: result.qz, reflectivity: result.reflectivityPlus, ...(session ? { scriptMessages } : {}) }
          : { qz: result.qz, reflectivityPlus: result.reflectivityPlus, reflectivityMinus: result.reflectivityMinus, asymmetry: result.asymmetry, ...(session ? { scriptMessages } : {}) } })
      }
    } catch (error) {
      const status = (error as { status?: number })?.status
      const text = status === 4 ? 'Qz exceeds the legacy calculation boundary.'
        : status === 3 ? 'The real engine could not allocate calculation memory.'
        : status === 2 ? 'The real engine produced a nonfinite numerical result.'
        : status === 1 ? 'The real engine rejected invalid calculation inputs.'
        : error instanceof Error ? error.message : 'The real engine calculation failed.'
      send({ id: message.id, type: 'error', message: text })
    }
  }
}
