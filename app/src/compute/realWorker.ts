import { createRealRequestHandler, type RealEngine } from './realEngine'
import type { WorkerRequest } from './protocol'

// Static module/adapter/WASM siblings are staged by the real-engine build harness.
// This entry is separate from the deployed mock worker until the full engine is ready.
const handle = createRealRequestHandler(response => self.postMessage(response), async () => {
  const coreUrl = new URL('./remagx-core.mjs', self.location.href).href
  const adapterUrl = new URL('./parratt.mjs', self.location.href).href
  const [core, adapter] = await Promise.all([
    import(/* @vite-ignore */ coreUrl), import(/* @vite-ignore */ adapterUrl),
  ])
  const instance = await core.default()
  return { dielectricTensor: request => adapter.calculateDielectricTensor(instance, request),
    matrixQz: request => adapter.calculateVisnovskyQz(instance, request),
    energyScan: request => adapter.calculateParrattEnergyScan(instance, request),
    calculate: request => adapter.calculateParrattQz(instance, request),
    lookup: (table, queries, cursor) => adapter.lookupTable(instance, table, queries, cursor) } satisfies RealEngine
})
self.onmessage = (event: MessageEvent<WorkerRequest>) => { void handle(event.data) }
