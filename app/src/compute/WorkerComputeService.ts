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

// If a fit does not end within this time after stopFit(), the worker is restarted (D-12).
export const STOP_TIMEOUT_MS = 2000

const createWorker = (): WorkerPort => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort

export class WorkerComputeService implements ComputeService {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private worker: WorkerPort
  private readonly createWorker: () => WorkerPort
  private stopTimer: ReturnType<typeof setTimeout> | null = null

  constructor(createPort: () => WorkerPort = createWorker) {
    this.createWorker = createPort
    this.worker = this.connect()
  }

  private connect(): WorkerPort {
    const worker = this.createWorker()
    worker.onmessage = (event) => this.receive(event.data)
    return worker
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

  calcChi2(project: Project): Promise<number> {
    return this.request('chi2', project)
  }

  startFit(project: Project, onProgress: (progress: FitProgress) => void): Promise<FitResult> {
    return this.request('fit', project, onProgress)
  }

  stopFit(): void {
    this.worker.postMessage({ kind: 'stopFit' })
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = setTimeout(() => this.restart('The computation did not react to Stop and was cancelled.'), STOP_TIMEOUT_MS)
  }

  // Terminates a stuck worker and starts a fresh one; all open requests fail with `reason`.
  private restart(reason: string): void {
    this.stopTimer = null
    if (this.pending.size === 0) return
    this.worker.terminate()
    for (const { reject } of this.pending.values()) reject(new ComputeError(reason))
    this.pending.clear()
    this.worker = this.connect()
  }

  dispose(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer)
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
    if (this.pending.size === 0 && this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    if (response.type === 'result') pending.resolve(response.result)
    else pending.reject(new ComputeError(response.message))
  }
}
