import { createBrowserLuaRuntime } from './lua/browserRuntime'
import { createRealRequestHandler, type RealEngine } from './realEngine'
import type { WorkerRequest } from './protocol'

// Worker startup shared by the default entry and explicit-sample reference harnesses.
// Production uses the D-41 full-double standard lookup; references may inject samples.
export function startRealWorker(errorSamples?: readonly number[] | 'standard', assetVersion?: string) {
  if (errorSamples !== undefined && errorSamples !== 'standard' && (errorSamples.length !== 1001 || !Array.from(errorSamples).every(Number.isFinite))) {
    throw new Error('Worker segmentation requires 1001 finite lookup samples.')
  }
  const suppliedSamples = Array.isArray(errorSamples) ? Array.from(errorSamples) : undefined
  let luaRuntime: ReturnType<typeof createBrowserLuaRuntime> | undefined
  const handle = createRealRequestHandler(response => self.postMessage(response), async () => {
    const assetUrl = (name: string) => {
      const url = new URL(name, self.location.href)
      if (assetVersion) url.searchParams.set('v', assetVersion)
      return url.href
    }
    const coreUrl = assetUrl('./remagx-core.mjs')
    const adapterUrl = assetUrl('./parratt.mjs')
    const fitErrorUrl = assetUrl('./fit_error.mjs')
    const optimizerUrl = assetUrl('./optimizer.mjs')
    const [core, adapter, fitErrorAdapter, optimizerAdapter] = await Promise.all([
      import(/* @vite-ignore */ coreUrl), import(/* @vite-ignore */ adapterUrl), import(/* @vite-ignore */ fitErrorUrl), import(/* @vite-ignore */ optimizerUrl),
    ])
    const instance = await core.default(assetVersion ? { locateFile: (name: string) => assetUrl(name) } : undefined)
    const samples = errorSamples === 'standard' ? Array.from(adapter.generateErrorFunctionLookup(instance)) as number[] : suppliedSamples
    const segmentationAdapter = samples ? await import(/* @vite-ignore */ assetUrl('./segmentation.mjs')) : undefined
    const segmentation: RealEngine['segmentation'] = samples ? {
      errorSamples: samples,
      sample: request => segmentationAdapter.calculateSegmentedOptics(instance, request),
      prepareSampler: request => segmentationAdapter.createSegmentedOpticalSampler(instance, request),
      subdivide: request => segmentationAdapter.calculateAdaptiveSegments(instance, request),
      density: request => adapter.calculateLayerDensity(instance, request),
      apply: request => adapter.applyMagneticProfiles(instance, request),
    } : undefined
    const elementPreparation: RealEngine['elementPreparation'] = samples ? {
      errorSamples: samples,
      density: request => adapter.calculateElementDensity(instance, request),
      optics: request => adapter.calculateElementOptics(instance, request),
    } : undefined
    return { segmentation, elementPreparation, createLookupSession: () => adapter.createTableLookupSession(instance),
      convolveFastQz: (qz, values, width) => adapter.convolveFastQz(instance, qz, values, width),
      gaussLorentzianReal: (...parameters) => adapter.calculateGaussLorentzianReal(instance, parameters),
      gaussLorentzianImag: (...parameters) => adapter.calculateGaussLorentzianImag(instance, parameters),
      minimize: request => request.annealing
        ? optimizerAdapter.minimizeAnnealing(instance, { ...request, ...request.annealing })
        : optimizerAdapter.minimizeAdaptiveSimplex(instance, request),
      fitError: request => fitErrorAdapter.calculateFitError(instance, request),
      scatteringTensor: request => adapter.calculateScatteringTensor(instance, request),
      dielectricTensor: request => adapter.calculateDielectricTensor(instance, request),
      zakQz: request => adapter.calculateZakQz(instance, request),
      zakEnergy: request => adapter.calculateZakEnergyScan(instance, request),
      matrixQz: request => adapter.calculateVisnovskyQz(instance, request),
      matrixEnergy: request => adapter.calculateVisnovskyEnergyScan(instance, request),
      energyScan: request => adapter.calculateParrattEnergyScan(instance, request),
      calculate: request => adapter.calculateParrattQz(instance, request),
      lookup: (table, queries, cursor) => adapter.lookupTable(instance, table, queries, cursor) } satisfies RealEngine
  }, () => (luaRuntime ??= createBrowserLuaRuntime()).createSession())
  self.onmessage = (event: MessageEvent<WorkerRequest>) => { void handle(event.data) }
}
