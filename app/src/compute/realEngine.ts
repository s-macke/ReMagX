import { prepareStandaloneEnergyScan } from '../model/standaloneEnergyScan'
import type { OpticalTable } from '../import/tables'
import { prepareManualScript } from '../model/manualScript'
import { createBeforeCalculation, createProjectScript } from './lua/beforeCalculation'
import type { LuaSession } from './lua/runtime'
import { realTensor } from '../model/realTensor'
import { realLayerSpectrum, realScatteringFactors } from '../model/realSpectrum'
import { realDatabaseValues } from '../model/realDatabaseValues'
import { runRealFit, type RealMinimizer } from '../model/realFit'
import { calculateRealCurve, type RealCalculationEngine } from '../model/realCalculation'
import { evaluateProjectDatasetErrorAsync, prepareStandaloneDatasetError, type FitErrorCalculator } from '../model/projectDatasetError'
import type { WorkerRequest, WorkerResponse } from './protocol'
export type { RealQzCalculator } from '../model/realCalculation'
export interface RealEngine extends RealCalculationEngine { fitError: FitErrorCalculator; minimize?: RealMinimizer }

// Uses the existing worker protocol. Unported operations never fall back to the mock.
export function createRealRequestHandler(send: (response: WorkerResponse) => void, load: () => Promise<RealEngine>, createLuaSession?: () => Promise<LuaSession>) {
  let calculator: Promise<RealEngine> | null = null
  return async (message: WorkerRequest): Promise<void> => {
    if (message.kind === 'stopFit') return // Standalone Stop terminates this worker through WorkerComputeService.
    try {
      if (message.kind !== 'executeScript' && message.kind !== 'reflectivity' && message.kind !== 'asymmetry' && message.kind !== 'energyScan' && message.kind !== 'energyAsymmetry' && message.kind !== 'chi2' && message.kind !== 'fit' && message.kind !== 'databaseValues' && message.kind !== 'layerSpectrum' && message.kind !== 'scatteringFactors' && message.kind !== 'dielectricTensor') {
        throw new Error(`The real engine does not support ${message.kind} yet.`)
      }
      calculator ??= load().catch(error => { calculator = null; throw error })
      const engine = await calculator
      if (message.kind === 'executeScript') {
        if (!createLuaSession) throw new Error('Lua script execution is unavailable.')
        const prepared = prepareManualScript(message.project, message.spectrum.tables, engine)
        const session = await createLuaSession(), scriptMessages: string[] = []
        try {
          const execute = createProjectScript(message.spectrum.program, session, engine, message.spectrum.tables, text => {
            scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] })
          })
          const result = execute(prepared.project, prepared.opticalState, 0, 'temporary')
          send({ id: message.id, type: 'result', result: { ...result, scriptMessages } })
        } finally { session.close() }
        return
      }
      if (message.kind === 'dielectricTensor') {
        const scripted = message.spectrum.spectrum && message.project.scripts.enabled && message.project.scripts.beforeCalculation.trim()
        const session = scripted && createLuaSession ? await createLuaSession() : undefined
        const scriptMessages: string[] = []
        try {
          const hook = session ? createBeforeCalculation(session, engine, message.spectrum.tables, text => {
            scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] })
          }) : undefined
          const result = realTensor(message.project, message.spectrum, engine.lookup, engine.dielectricTensor, hook)
          send({ id: message.id, type: 'result', result: { ...result, ...(session ? { scriptMessages } : {}) } })
        } finally { session?.close() }
        return
      }
      if (message.kind === 'layerSpectrum' || message.kind === 'scatteringFactors') {
        const scripted = message.project.scripts.enabled && message.project.scripts.beforeCalculation.trim()
        const session = scripted && createLuaSession ? await createLuaSession() : undefined
        const scriptMessages: string[] = []
        try {
          const hook = session ? createBeforeCalculation(session, engine, message.spectrum.tables, text => {
            scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] })
          }) : undefined
          const result = message.kind === 'layerSpectrum' ? realLayerSpectrum(message.project, message.spectrum, engine.lookup, engine.scatteringTensor, hook)
            : realScatteringFactors(message.project, message.spectrum, engine.lookup, engine.scatteringTensor, hook)
          send({ id: message.id, type: 'result', result: { ...result, ...(session ? { scriptMessages } : {}) } })
        } finally { session?.close() }
        return
      }
      if (message.kind === 'databaseValues') {
        send({ id: message.id, type: 'result', result: realDatabaseValues(message.project, message.spectrum.tables, engine.lookup) })
        return
      }
      if (message.kind === 'fit') {
        if (!engine.minimize) throw new Error('The real optimizer is unavailable.')
        const hasScript = message.project.scripts.enabled && message.project.scripts.beforeCalculation.trim()
        const session = hasScript && createLuaSession ? await createLuaSession() : undefined
        try {
          const scriptMessages: string[] = []
          const hook = session ? createBeforeCalculation(session, engine, message.tables ?? [], text => { scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] }) }) : undefined
          const result = runRealFit(message.project, message.tables ?? [], engine, engine.minimize,
            progress => send({ id: message.id, type: 'fitProgress', progress }), undefined, hook)
          send({ id: message.id, type: 'result', result: { ...result, ...(session ? { scriptMessages } : {}) } })
        } finally { session?.close() }
        return
      }
      if (message.kind === 'chi2') {
        // Table resolution belongs to the film state, even across temporary Lua VMs.
        const resolvedTables = new Map<number, OpticalTable>()
        const initial = prepareStandaloneDatasetError(message.project, message.tables ?? [], engine.lookup)
        const result = await evaluateProjectDatasetErrorAsync(initial.project, engine.fitError, async (prepared, previous) => {
          const scripted = prepared.project.scripts.enabled && prepared.project.scripts.beforeCalculation.trim()
          const session = scripted && createLuaSession ? await createLuaSession() : undefined
          try {
            const hook = session ? createBeforeCalculation(session, engine, message.tables ?? [],
              text => send({ id: message.id, type: 'scriptMessages', lines: [text] }), resolvedTables) : undefined
            return calculateRealCurve(prepared.project, message.tables ?? [], engine, prepared.scan, prepared.beams, previous, hook)
          } finally { session?.close() }
        }, initial.opticalState)
        send({ id: message.id, type: 'result', result: result.error })
        return
      }
      const energy = message.kind === 'energyScan' || message.kind === 'energyAsymmetry'
      const mode = message.kind === 'reflectivity' || message.kind === 'energyScan' ? 'monochromatic' : 'dichroic'
      const preparedEnergy = energy ? prepareStandaloneEnergyScan(message.project, message.tables ?? [], engine) : undefined
      const hasScript = message.project.scripts.enabled && message.project.scripts.beforeCalculation.trim()
      const session = hasScript && createLuaSession ? await createLuaSession() : undefined
      const scriptMessages: string[] = []
      let result
      try {
        const hook = session ? createBeforeCalculation(session, engine, message.tables ?? [], text => { scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] }) }) : undefined
        result = calculateRealCurve(preparedEnergy?.project ?? message.project, message.tables ?? [], engine, energy ? 'energy' : 'qz', mode, preparedEnergy?.opticalState, hook)
      } finally { session?.close() }
      if (energy) {
        if (!result.energy) throw new Error('Missing energy-scan coordinates.')
        send({ id: message.id, type: 'result', result: message.kind === 'energyScan'
          ? { energy: result.energy, reflectivity: result.reflectivityPlus, ...(session ? { scriptMessages } : {}) }
          : { energy: result.energy, reflectivityPlus: result.reflectivityPlus, reflectivityMinus: result.reflectivityMinus, asymmetry: result.asymmetry, ...(session ? { scriptMessages } : {}) } })
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
