import { WorkerComputeService, type WorkerPort } from './WorkerComputeService'

// Explicit factory for integration tests and the eventual engine switch. The public
// application's default factory continues to use the mock until engine acceptance.
export function createRealComputeService() {
  return new WorkerComputeService(() => new Worker(new URL('./realWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort)
}
