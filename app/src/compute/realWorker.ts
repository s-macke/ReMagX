import { createBrowserLuaRuntime } from './lua/browserRuntime'
import { createRealRequestHandler, type RealEngine } from './realEngine'
import type { WorkerRequest } from './protocol'

// Static module/adapter/WASM siblings are staged by the real-engine build harness.
// This entry is separate from the deployed mock worker until the full engine is ready.
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
  return { gaussLorentzianReal: (...parameters) => adapter.calculateGaussLorentzianReal(instance, parameters),
    gaussLorentzianImag: (...parameters) => adapter.calculateGaussLorentzianImag(instance, parameters),
    minimize: request => optimizerAdapter.minimizeSimplex(instance, request),
    fitError: request => fitErrorAdapter.calculateFitError(instance, request),
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
