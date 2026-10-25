import { assertSupportedFitTargets } from '../model/fitCapabilities'
import { convertMaterialElements } from '../model/materialElements'
import { calculationErrorMessage } from '../model/calculationErrors'
import { realLayerList } from '../model/realLayerList'
import { realDensityProfiles } from '../model/realDensityProfiles'
import { realDepthProfile } from '../model/realDepthProfile'
import { assertRealAlgorithm } from '../model/realAlgorithm'
import { prepareStandaloneQz } from '../model/standaloneQz'
import { prepareStandaloneFit } from '../model/standaloneFit'
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
export interface RealEngine extends RealCalculationEngine {
  fitError: FitErrorCalculator; minimize?: RealMinimizer
  createLookupSession?: () => { lookup: RealCalculationEngine['lookup']; dispose(): void }
}

// Uses the existing worker protocol. Unported operations never fall back to the mock.
export function createRealRequestHandler(send: (response: WorkerResponse) => void, load: () => Promise<RealEngine>, createLuaSession?: () => Promise<LuaSession>) {
  let calculator: Promise<RealEngine> | null = null
  return async (message: WorkerRequest): Promise<void> => {
    if (message.kind === 'stopFit') return // Standalone Stop terminates this worker through WorkerComputeService.
    let lookupSession: ReturnType<NonNullable<RealEngine['createLookupSession']>> | undefined
    try {
      if (message.kind !== 'materialToElements' && message.kind !== 'segmentLayers' && message.kind !== 'densityProfiles' && message.kind !== 'depthProfile' && message.kind !== 'executeScript' && message.kind !== 'reflectivity' && message.kind !== 'asymmetry' && message.kind !== 'energyScan' && message.kind !== 'energyAsymmetry' && message.kind !== 'chi2' && message.kind !== 'fit' && message.kind !== 'databaseValues' && message.kind !== 'layerSpectrum' && message.kind !== 'scatteringFactors' && message.kind !== 'dielectricTensor') {
        throw new Error(`The real engine does not support ${message.kind} yet.`)
      }
      if (message.kind === 'materialToElements') {
        send({ id: message.id, type: 'result', result: convertMaterialElements(message.project) })
        return
      }
      if (message.kind === 'reflectivity' || message.kind === 'asymmetry' ||
          message.kind === 'energyScan' || message.kind === 'energyAsymmetry' ||
          message.kind === 'chi2' || message.kind === 'fit') {
        assertRealAlgorithm(message.project.calculation.algorithm)
      }
      if (message.kind === 'fit') assertSupportedFitTargets(message.project)
      const suppliedTables = 'spectrum' in message ? message.spectrum.tables : message.tables ?? []
      // Load the static asset only in the real worker when fallback is enabled.
      // Keep the resolved list request-local; never write built-ins into the library.
      const tables = message.project.calculation.useChantlerDatabase && message.project.sample.mode === 'element'
        ? (await import('../model/chantlerTables')).resolveChantlerTables(message.project, suppliedTables)
        : suppliedTables
      calculator ??= load().catch(error => { calculator = null; throw error })
      const loaded = await calculator
      lookupSession = loaded.createLookupSession?.()
      const engine = lookupSession ? { ...loaded, lookup: lookupSession.lookup } : loaded
      if (message.kind === 'segmentLayers' || message.kind === 'depthProfile' || message.kind === 'densityProfiles') {
        const scripted = message.project.scripts.enabled && message.project.scripts.beforeCalculation.trim()
        const session = scripted && createLuaSession ? await createLuaSession() : undefined
        const scriptMessages: string[] = []
        try {
          const hook = session ? createBeforeCalculation(session, engine, tables, text => {
            scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] })
          }) : undefined
          const result = message.kind === 'segmentLayers'
            ? { layers: realLayerList(message.project, tables, engine, hook), engine: 'real' as const }
            : (message.kind === 'depthProfile' ? realDepthProfile : realDensityProfiles)(message.project, tables, engine, hook)
          send({ id: message.id, type: 'result', result: { ...result, ...(session ? { scriptMessages } : {}) } })
        } finally { session?.close() }
        return
      }
      if (message.kind === 'executeScript') {
        if (!createLuaSession) throw new Error('Lua script execution is unavailable.')
        const prepared = prepareManualScript(message.project, tables, engine)
        const session = await createLuaSession(), scriptMessages: string[] = []
        try {
          const execute = createProjectScript(message.spectrum.program, session, engine, tables, text => {
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
          const hook = session ? createBeforeCalculation(session, engine, tables, text => {
            scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] })
          }) : undefined
          const result = realTensor(message.project, { ...message.spectrum, tables }, engine.lookup, engine.dielectricTensor, hook)
          send({ id: message.id, type: 'result', result: { ...result, ...(session ? { scriptMessages } : {}) } })
        } finally { session?.close() }
        return
      }
      if (message.kind === 'layerSpectrum' || message.kind === 'scatteringFactors') {
        const scripted = message.project.scripts.enabled && message.project.scripts.beforeCalculation.trim()
        const session = scripted && createLuaSession ? await createLuaSession() : undefined
        const scriptMessages: string[] = []
        try {
          const hook = session ? createBeforeCalculation(session, engine, tables, text => {
            scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] })
          }) : undefined
          const result = message.kind === 'layerSpectrum' ? realLayerSpectrum(message.project, { ...message.spectrum, tables }, engine.lookup, engine.scatteringTensor, hook)
            : realScatteringFactors(message.project, { ...message.spectrum, tables }, engine.lookup, engine.scatteringTensor, hook)
          send({ id: message.id, type: 'result', result: { ...result, engine: 'real', ...(session ? { scriptMessages } : {}) } })
        } finally { session?.close() }
        return
      }
      if (message.kind === 'databaseValues') {
        send({ id: message.id, type: 'result', result: realDatabaseValues(message.project, tables, engine) })
        return
      }
      if (message.kind === 'fit') {
        if (!engine.minimize) throw new Error('The real optimizer is unavailable.')
        const prepared = prepareStandaloneFit(message.project, tables, engine)
        const hasScript = message.project.scripts.enabled && message.project.scripts.beforeCalculation.trim()
        const session = hasScript && createLuaSession ? await createLuaSession() : undefined
        try {
          const scriptMessages: string[] = []
          const hook = session ? createBeforeCalculation(session, engine, tables, text => { scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] }) }) : undefined
          const result = runRealFit(prepared.project, tables, engine, engine.minimize,
            progress => send({ id: message.id, type: 'fitProgress', progress }), undefined, hook, prepared.opticalState)
          send({ id: message.id, type: 'result', result: { ...result, ...(session ? { scriptMessages } : {}) } })
        } finally { session?.close() }
        return
      }
      if (message.kind === 'chi2') {
        // Table resolution belongs to the film state, even across temporary Lua VMs.
        const resolvedTables = new Map<number, OpticalTable>()
        const initial = prepareStandaloneDatasetError(message.project, tables, engine)
        const result = await evaluateProjectDatasetErrorAsync(initial.project, engine.fitError, async (prepared, previous) => {
          const scripted = prepared.project.scripts.enabled && prepared.project.scripts.beforeCalculation.trim()
          const session = scripted && createLuaSession ? await createLuaSession() : undefined
          try {
            const hook = session ? createBeforeCalculation(session, engine, tables,
              text => send({ id: message.id, type: 'scriptMessages', lines: [text] }), resolvedTables) : undefined
            return calculateRealCurve(prepared.project, tables, engine, prepared.scan, prepared.beams, previous, hook)
          } finally { session?.close() }
        }, initial.opticalState)
        send({ id: message.id, type: 'result', result: result.error })
        return
      }
      const energy = message.kind === 'energyScan' || message.kind === 'energyAsymmetry'
      const mode = message.kind === 'reflectivity' || message.kind === 'energyScan' ? 'monochromatic' : 'dichroic'
      const prepared = energy ? prepareStandaloneEnergyScan(message.project, tables, engine)
        : prepareStandaloneQz(message.project, tables, engine)
      const hasScript = message.project.scripts.enabled && message.project.scripts.beforeCalculation.trim()
      const session = hasScript && createLuaSession ? await createLuaSession() : undefined
      const scriptMessages: string[] = []
      let result
      try {
        const hook = session ? createBeforeCalculation(session, engine, tables, text => { scriptMessages.push(text); send({ id: message.id, type: 'scriptMessages', lines: [text] }) }) : undefined
        result = calculateRealCurve(prepared.project, tables, engine, energy ? 'energy' : 'qz', mode, prepared.opticalState, hook)
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
      send({ id: message.id, type: 'error', message: calculationErrorMessage(error) })
    } finally { lookupSession?.dispose() }
  }
}
