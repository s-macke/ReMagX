import type { OpticalTable } from '../import/tables'
import { WorkerComputeService, type WorkerPort } from './WorkerComputeService'

// Explicit factory for integration tests; the default application worker also uses WASM.
export function createRealComputeService(getTables: () => OpticalTable[] = () => []) {
  return new WorkerComputeService(() => new Worker(new URL('./realWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort, getTables, true, true)
}
