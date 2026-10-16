// ComputeService implementation that forwards requests to the compute worker.

import type { OpticalTable } from '../import/tables'
import type { DatabaseValues } from '../model/databaseValues'
import type { TensorPreview } from '../model/tensorView'
import type { Layer, Project } from '../model/project'
import {
  ComputeError,
  ComputeCancelled,
  type AsymmetryCurve,
  type ComputeService,
  type TensorQuery,
  type DepthProfile,
  type DensityProfiles,
  type EnergyScanCurve,
  type FitProgress,
  type FitResult,
  type LayerSpectrum,
  type LayerSpectrumQuery,
  type ElementSpectrumQuery,
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
  kind: keyof CalculationResults
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (progress: FitProgress) => void
}

// Leave time for the UI to settle within D-28’s 1 s deadline, even for a stuck fit.
export const STOP_TIMEOUT_MS = 250

const createWorker = (): WorkerPort => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort

export class WorkerComputeService implements ComputeService {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private worker: WorkerPort | null = null
  private disposed = false
  private stopping = false
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

  scatteringFactors(project: Project, spectrum: ElementSpectrumQuery): Promise<LayerSpectrum> {
    return this.request('scatteringFactors', project, undefined, spectrum)
  }

  layerSpectrum(project: Project, spectrum: LayerSpectrumQuery): Promise<LayerSpectrum> {
    return this.request('layerSpectrum', project, undefined, spectrum)
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

  databaseValues(project: Project, tables: OpticalTable[]): Promise<DatabaseValues> {
    return this.request('databaseValues', project, undefined, { tables })
  }

  dielectricTensor(project: Project, query: TensorQuery): Promise<TensorPreview> {
    return this.request('dielectricTensor', project, undefined, query)
  }

  densityProfiles(project: Project): Promise<DensityProfiles> {
    return this.request('densityProfiles', project)
  }

  segmentLayers(project: Project): Promise<Layer[]> {
    return this.request('segmentLayers', project)
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
    this.stop()
  }

  stop(): void {
    if (!this.worker || this.pending.size === 0 || this.stopping) return
    // Standalone calculations are synchronous inside the worker and cannot process a Stop
    // message until they finish. Terminating them immediately also clears queued requests.
    if (![...this.pending.values()].some((request) => request.kind === 'fit')) {
      this.failWorker(new ComputeCancelled())
      return
    }
    this.stopping = true
    this.stopTimer = setTimeout(
      () => this.failWorker(new ComputeCancelled('Stopped. The computation did not react to Stop.')),
      STOP_TIMEOUT_MS,
    )
    try {
      this.worker.postMessage({ kind: 'stopFit' })
    } catch {
      // If delivery fails, cancellation still succeeds by terminating the worker.
      this.failWorker(new ComputeCancelled())
    }
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer)
    this.stopTimer = null
    this.stopping = false
  }

  // Fail all requests without touching the project. Create a replacement only when new work
  // arrives, so a worker that cannot load does not enter an automatic restart loop.
  private failWorker(reason: string | ComputeError): void {
    this.clearStopTimer()
    const worker = this.worker
    this.worker = null
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }
    for (const { reject } of this.pending.values()) reject(typeof reason === 'string' ? new ComputeError(reason) : reason)
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
    spectrum?: TensorQuery | LayerSpectrumQuery | ElementSpectrumQuery | { tables: OpticalTable[] },
  ): Promise<CalculationResults[K]> {
    if (this.disposed) return Promise.reject(new ComputeError('Compute service was shut down.'))
    if (this.stopping) return Promise.reject(new ComputeCancelled())
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { kind, resolve: resolve as (value: unknown) => void, reject, onProgress })
      try {
        this.worker ??= this.connect()
        this.worker.postMessage({ id, kind, project, ...(spectrum ? { spectrum } : {}) } as WorkerRequest)
      } catch (error) {
        this.failWorker(`Could not start the computation: ${String(error)}`)
      }
    })
  }

  private receive(response: WorkerResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    if (response.type === 'fitProgress') {
      if (!this.stopping) pending.onProgress?.(response.progress)
      return
    }
    const wasStopping = this.stopping
    this.pending.delete(response.id)
    if (this.pending.size === 0) this.clearStopTimer()
    if (wasStopping) {
      if (pending.kind === 'fit' && response.type === 'result') {
        pending.resolve({ ...response.result as FitResult, stopped: true })
      } else pending.reject(new ComputeCancelled())
    } else if (response.type === 'result') pending.resolve(response.result)
    else pending.reject(new ComputeError(response.message))
  }
}
