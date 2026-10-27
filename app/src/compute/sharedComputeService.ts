import { WorkerComputeService } from './WorkerComputeService'
import type { ComputeService } from './ComputeService'

// Shared by the main workspace, fitting, scripting and material actions.
// Summary and line fitting own separate workers.
let sharedService: ComputeService | null = null
export function computeService(): ComputeService {
  sharedService ??= new WorkerComputeService()
  return sharedService
}

// A structural edit makes all old worker work unusable. Dispose immediately so
// the new project can calculate without waiting for cooperative fit cancellation.
export function discardComputeService(): void {
  sharedService?.dispose()
  sharedService = null
}

