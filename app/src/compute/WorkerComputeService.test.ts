import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject } from '../model/defaults'
import type { Project } from '../model/project'
import { calcReflectivity } from './mockPhysics'
import { createRequestHandler } from './mockEngine'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { STOP_TIMEOUT_MS, WorkerComputeService, type WorkerPort } from './WorkerComputeService'

// Runs the worker-side handler in-process, with structuredClone standing in for the message copy.
function inProcessWorker(): WorkerPort {
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message: WorkerRequest) {
      setTimeout(() => void handle(structuredClone(message)), 0)
    },
    terminate() {},
  }
  const handle = createRequestHandler((response: WorkerResponse) => {
    port.onmessage?.({ data: structuredClone(response) } as MessageEvent<WorkerResponse>)
  })
  return port
}

// Synthetic measurement of a single 50 Å layer, to be fitted from a wrong start value.
function fitProject(): Project {
  const project = createDefaultProject()
  const [substrate, , , vacuum] = project.sample.layers
  project.sample.layers = [substrate, { ...project.sample.layers[1], thickness: 50 }, vacuum]
  project.experiment.qzScan = { ...project.experiment.qzScan, qzMin: 0.02, qzMax: 0.4, points: 150 }
  const truth = calcReflectivity(project)
  project.datasets.push({
    title: 'synthetic',
    comment: '',
    sourceFile: '',
    energy: project.experiment.energy,
    energyShift: 0,
    angularResolution: 0,
    intensityScale: 1,
    intensityOffset: 0,
    qzShift: 0,
    errorWeight: 1,
    polarization: project.experiment.polarization,
    active: true,
    columns: { qz: truth.qz, reflectivity: truth.reflectivity },
  })
  project.activeDatasetIndex = 0
  project.sample.layers[1].thickness = 46
  project.fit.parameters = [
    { target: 'thickness', index: 1, elementIndex: null, value: 46, step: 2, lowerBound: 30, upperBound: 70 },
  ]
  return project
}

afterEach(() => vi.useRealTimers())

describe('WorkerComputeService with the mock engine', () => {
  it('returns a reflectivity curve', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const curve = await service.calcReflectivity(createDefaultProject())
    expect(curve.qz).toHaveLength(300)
  })

  it('turns engine errors into rejected promises with the message', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    project.experiment.qzScan.qzMax = 50
    await expect(service.calcReflectivity(project)).rejects.toThrow(/above 90°/)
  })

  it('fits a layer thickness back to the true value and reports progress', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const progress: number[] = []
    const result = await service.startFit(fitProject(), (p) => progress.push(p.chi2))
    expect(result.stopped).toBe(false)
    expect(result.project.sample.layers[1].thickness).toBeCloseTo(50, 2)
    expect(progress.length).toBeGreaterThan(2)
  })

  it('stops a running fit within one second', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = fitProject()
    project.fit.algorithm = 'simplex-annealing'
    let stopRequestedAt = 0
    const result = await service.startFit(project, () => {
      if (stopRequestedAt === 0) {
        stopRequestedAt = performance.now()
        service.stopFit()
      }
    })
    expect(result.stopped).toBe(true)
    expect(performance.now() - stopRequestedAt).toBeLessThan(1000)
  })

  it('discards a worker that ignores Stop and replaces it on the next request', async () => {
    vi.useFakeTimers()
    let created = 0
    const silentWorker = (): WorkerPort => {
      created++
      return { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() {} }
    }
    const service = new WorkerComputeService(silentWorker)
    const fit = service.startFit(fitProject(), () => {})
    service.stopFit()
    vi.advanceTimersByTime(STOP_TIMEOUT_MS)
    await expect(fit).rejects.toThrow(/did not react to Stop/)
    expect(created).toBe(1)
    const next = service.calcReflectivity(createDefaultProject())
    expect(created).toBe(2)
    service.dispose()
    await expect(next).rejects.toThrow(/shut down/)
  })

  it('rejects fit targets the mock does not support', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = fitProject()
    project.fit.parameters[0] = { ...project.fit.parameters[0], target: 'elementF1' }
    await expect(service.startFit(project, () => {})).rejects.toThrow(/elementF1/)
  })
})

function controlledWorker() {
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn<WorkerPort['postMessage']>(),
    terminate: vi.fn(),
  }
  return port
}

function deliverResult(port: WorkerPort, result: number) {
  const request = vi.mocked(port.postMessage).mock.calls.at(-1)![0]
  if (!('id' in request)) throw new Error('Expected a calculation request')
  port.onmessage?.({ data: { id: request.id, type: 'result', result } } as MessageEvent<WorkerResponse>)
}

describe('WorkerComputeService failure recovery', () => {
  it('rejects concurrent work on a crash, preserves edits, and ignores events from the old worker', async () => {
    vi.useFakeTimers()
    const first = controlledWorker()
    const second = controlledWorker()
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const service = new WorkerComputeService(factory)
    const project = createDefaultProject()
    const progress = vi.fn()
    const fit = service.startFit(project, progress)
    const curve = service.calcReflectivity(project)
    const failures = Promise.all([
      expect(fit).rejects.toThrow('worker failed: test crash'),
      expect(curve).rejects.toThrow('worker failed: test crash'),
    ])
    const lateMessage = first.onmessage!
    const lateError = first.onerror!
    const lateMessageError = first.onmessageerror!
    project.sample.layers[1].thickness = 123
    const edited = JSON.stringify(project)
    service.stopFit()
    const preventDefault = vi.fn()
    first.onerror?.({ message: 'test crash', preventDefault } as unknown as ErrorEvent)
    await failures
    expect(JSON.stringify(project)).toBe(edited)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(first.terminate).toHaveBeenCalledOnce()
    expect(first.onmessage).toBeNull()
    expect(first.onerror).toBeNull()
    expect(first.onmessageerror).toBeNull()
    expect(factory).toHaveBeenCalledTimes(1)

    const next = service.calcChi2(project)
    const request = vi.mocked(second.postMessage).mock.calls[0][0]
    if (!('id' in request)) throw new Error('Expected a calculation request')
    lateMessage({ data: { id: request.id, type: 'result', result: 999 } } as MessageEvent<WorkerResponse>)
    lateError({ message: 'late error', preventDefault } as unknown as ErrorEvent)
    lateMessageError({} as MessageEvent)
    vi.advanceTimersByTime(STOP_TIMEOUT_MS)
    expect(second.terminate).not.toHaveBeenCalled()
    deliverResult(second, 4)
    await expect(next).resolves.toBe(4)
    expect(progress).not.toHaveBeenCalled()
    service.dispose()
  })

  it('rejects unreadable messages and recovers on the next calculation', async () => {
    const first = controlledWorker()
    const second = controlledWorker()
    const service = new WorkerComputeService(vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second))
    const result = service.calcChi2(createDefaultProject())
    const failure = expect(result).rejects.toThrow('unreadable message')
    first.onmessageerror?.({} as MessageEvent)
    await failure
    expect(first.terminate).toHaveBeenCalledOnce()
    const next = service.calcChi2(createDefaultProject())
    deliverResult(second, 2)
    await expect(next).resolves.toBe(2)
    service.dispose()
  })

  it('reports worker construction failure as a rejected request and permits retry', async () => {
    const port = controlledWorker()
    const factory = vi.fn().mockImplementationOnce(() => { throw new Error('worker unavailable') }).mockReturnValue(port)
    const service = new WorkerComputeService(factory)
    expect(factory).not.toHaveBeenCalled()
    await expect(service.calcChi2(createDefaultProject())).rejects.toThrow('worker unavailable')
    const retry = service.calcChi2(createDefaultProject())
    deliverResult(port, 3)
    await expect(retry).resolves.toBe(3)
    service.dispose()
  })

  it('rejects all pending work when sending a request throws', async () => {
    const first = controlledWorker()
    const second = controlledWorker()
    const service = new WorkerComputeService(vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second))
    const running = service.startFit(createDefaultProject(), () => {})
    const failure = expect(running).rejects.toThrow('could not clone')
    vi.mocked(first.postMessage).mockImplementationOnce(() => { throw new Error('could not clone') })
    await expect(service.calcChi2(createDefaultProject())).rejects.toThrow('could not clone')
    await failure
    expect(first.terminate).toHaveBeenCalledOnce()
    const retry = service.calcChi2(createDefaultProject())
    deliverResult(second, 1)
    await expect(retry).resolves.toBe(1)
    service.dispose()
  })

  it('handles Stop delivery failure without throwing or leaving the fit pending', async () => {
    vi.useFakeTimers()
    const port = controlledWorker()
    const service = new WorkerComputeService(() => port)
    const fit = service.startFit(createDefaultProject(), () => {})
    const failure = expect(fit).rejects.toThrow('Could not send Stop')
    vi.mocked(port.postMessage).mockImplementationOnce(() => { throw new Error('worker unavailable') })
    expect(() => service.stopFit()).not.toThrow()
    await failure
    expect(port.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disposes pending work once, clears Stop timers, and rejects further requests', async () => {
    vi.useFakeTimers()
    const port = controlledWorker()
    const factory = vi.fn(() => port)
    const service = new WorkerComputeService(factory)
    const result = service.calcChi2(createDefaultProject())
    const failure = expect(result).rejects.toThrow('shut down')
    service.stopFit()
    service.dispose()
    service.dispose()
    service.stopFit()
    await failure
    await expect(service.calcChi2(createDefaultProject())).rejects.toThrow('shut down')
    expect(port.terminate).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not schedule Stop on an idle service and recovers from an idle worker crash', async () => {
    vi.useFakeTimers()
    const first = controlledWorker()
    const second = controlledWorker()
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const service = new WorkerComputeService(factory)
    service.stopFit()
    expect(factory).not.toHaveBeenCalled()
    const result = service.calcChi2(createDefaultProject())
    deliverResult(first, 1)
    await result
    service.stopFit()
    expect(vi.getTimerCount()).toBe(0)
    first.onerror?.({ message: '', preventDefault() {} } as ErrorEvent)
    expect(first.terminate).toHaveBeenCalledOnce()
    const retry = service.calcChi2(createDefaultProject())
    deliverResult(second, 2)
    await expect(retry).resolves.toBe(2)
    service.dispose()
  })
})
