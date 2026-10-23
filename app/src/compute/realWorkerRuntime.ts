import { createBrowserLuaRuntime } from './lua/browserRuntime'
import { createRealRequestHandler, type RealEngine } from './realEngine'
import type { WorkerRequest } from './protocol'

// Worker startup shared by the default entry and explicit-sample reference harnesses.
// No production lookup generator is selected by this function.
export function startRealWorker(errorSamples?: readonly number[]) {
  if (errorSamples !== undefined && (errorSamples.length !== 1001 || !Array.from(errorSamples).every(Number.isFinite))) {
    throw new Error('Worker segmentation requires 1001 finite lookup samples.')
  }
  const samples = errorSamples === undefined ? undefined : Array.from(errorSamples)
  let luaRuntime: ReturnType<typeof createBrowserLuaRuntime> | undefined
  const handle = createRealRequestHandler(response => self.postMessage(response), async () => {
    const coreUrl = new URL('./remagx-core.mjs', self.location.href).href
    const adapterUrl = new URL('./parratt.mjs', self.location.href).href
    const fitErrorUrl = new URL('./fit_error.mjs', self.location.href).href
    const optimizerUrl = new URL('./optimizer.mjs', self.location.href).href
    const [core, adapter, fitErrorAdapter, optimizerAdapter] = await Promise.all([
      import(/* @vite-ignore */ coreUrl), import(/* @vite-ignore */ adapterUrl), import(/* @vite-ignore */ fitErrorUrl), import(/* @vite-ignore */ optimizerUrl),
    ])
    const instance = await core.default()
    const segmentationAdapter = samples ? await import(/* @vite-ignore */ new URL('./segmentation.mjs', self.location.href).href) : undefined
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
    return { segmentation, elementPreparation, createLookupSession: () => adapter.createTableLookupSession(instance), fourier: (qz, reflectivity) => adapter.calculateFourier(instance, qz, reflectivity),
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
