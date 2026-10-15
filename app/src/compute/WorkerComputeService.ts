// ComputeService implementation that forwards requests to the compute worker.

import type { Project } from '../model/project'
import {
  ComputeError,
  type AsymmetryCurve,
  type ComputeService,
  type DepthProfile,
  type EnergyScanCurve,
  type FitProgress,
  type FitResult,
  type ReflectivityCurve,
} from './ComputeService'
import type { CalculationResults, WorkerRequest, WorkerResponse } from './protocol'

// The part of the Worker API this class uses, so tests can pass an in-process stand-in.
export interface WorkerPort {
  postMessage(message: WorkerRequest): void
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null
  terminate(): void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (progress: FitProgress) => void
}

export class WorkerComputeService implements ComputeService {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly worker: WorkerPort

  constructor(worker?: WorkerPort) {
    this.worker =
      worker ?? (new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort)
    this.worker.onmessage = (event) => this.receive(event.data)
  }

  calcReflectivity(project: Project): Promise<ReflectivityCurve> {
    return this.request('reflectivity', project)
  }

  calcEnergyScan(project: Project): Promise<EnergyScanCurve> {
    return this.request('energyScan', project)
  }

  calcAsymmetry(project: Project): Promise<AsymmetryCurve> {
    return this.request('asymmetry', project)
  }

  depthProfile(project: Project): Promise<DepthProfile> {
    return this.request('depthProfile', project)
  }

  startFit(project: Project, onProgress: (progress: FitProgress) => void): Promise<FitResult> {
    return this.request('fit', project, onProgress)
  }

  stopFit(): void {
    this.worker.postMessage({ kind: 'stopFit' })
  }

  dispose(): void {
    this.worker.terminate()
    for (const { reject } of this.pending.values()) reject(new ComputeError('Compute service was shut down.'))
    this.pending.clear()
  }

  private request<K extends keyof CalculationResults>(
    kind: K,
    project: Project,
    onProgress?: (progress: FitProgress) => void,
  ): Promise<CalculationResults[K]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress })
      this.worker.postMessage({ id, kind, project } as WorkerRequest)
    })
  }

  private receive(response: WorkerResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    if (response.type === 'fitProgress') {
      pending.onProgress?.(response.progress)
      return
    }
    this.pending.delete(response.id)
    if (response.type === 'result') pending.resolve(response.result)
    else pending.reject(new ComputeError(response.message))
  }
}
