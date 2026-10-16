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
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  terminate(): void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (progress: FitProgress) => void
}

// If a fit does not end within this time after stopFit(), discard the worker (D-12).
export const STOP_TIMEOUT_MS = 2000

const createWorker = (): WorkerPort => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort

export class WorkerComputeService implements ComputeService {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private worker: WorkerPort | null = null
  private disposed = false
  private readonly createWorker: () => WorkerPort
  private stopTimer: ReturnType<typeof setTimeout> | null = null

  constructor(createPort: () => WorkerPort = createWorker) {
    this.createWorker = createPort
  }

  private connect(): WorkerPort {
    const worker = this.createWorker()
    worker.onmessage = (event) => {
      if (this.worker === worker) this.receive(event.data)
    }
    worker.onerror = (event) => {
      if (this.worker !== worker) return
      event.preventDefault()
      this.failWorker(`The compute worker failed${event.message ? `: ${event.message}` : '.'}`)
    }
    worker.onmessageerror = () => {
      if (this.worker === worker) this.failWorker('The compute worker returned an unreadable message.')
    }
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
    if (!this.worker || this.pending.size === 0) return
    try {
      this.worker.postMessage({ kind: 'stopFit' })
    } catch (error) {
      this.failWorker(`Could not send Stop to the compute worker: ${String(error)}`)
      return
    }
    this.clearStopTimer()
    this.stopTimer = setTimeout(() => this.failWorker('The computation did not react to Stop and was cancelled.'), STOP_TIMEOUT_MS)
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer)
    this.stopTimer = null
  }

  // Fail all requests without touching the project. Create a replacement only when new work
  // arrives, so a worker that cannot load does not enter an automatic restart loop.
  private failWorker(reason: string): void {
    this.clearStopTimer()
    const worker = this.worker
    this.worker = null
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    for (const { reject } of this.pending.values()) reject(new ComputeError(reason))
    this.pending.clear()
  }

  dispose(): void {
    this.disposed = true
    this.failWorker('Compute service was shut down.')
  }

  private request<K extends keyof CalculationResults>(
    kind: K,
    project: Project,
    onProgress?: (progress: FitProgress) => void,
  ): Promise<CalculationResults[K]> {
    if (this.disposed) return Promise.reject(new ComputeError('Compute service was shut down.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress })
      try {
        this.worker ??= this.connect()
        this.worker.postMessage({ id, kind, project } as WorkerRequest)
      } catch (error) {
        this.failWorker(`Could not start the computation: ${String(error)}`)
      }
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
    if (this.pending.size === 0) this.clearStopTimer()
    if (response.type === 'result') pending.resolve(response.result)
    else pending.reject(new ComputeError(response.message))
  }
}
