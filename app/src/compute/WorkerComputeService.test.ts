import { ComputeCancelled } from './ComputeService'
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
  const request = vi.mocked(port.postMessage).mock.calls.findLast(([message]) => 'id' in message)![0]
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
    const failure = expect(fit).rejects.toBeInstanceOf(ComputeCancelled)
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
    const result = service.startFit(createDefaultProject(), () => {})
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

describe('cancellation deadline', () => {
  it.each(['calcReflectivity', 'calcEnergyScan', 'calcEnergyAsymmetry', 'calcAsymmetry', 'depthProfile', 'calcChi2'] as const)(
    'immediately stops %s and queued work without changing the project', async (method) => {
      const first = controlledWorker()
      const second = controlledWorker()
      const service = new WorkerComputeService(vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second))
      const project = createDefaultProject()
      const before = JSON.stringify(project)
      const calculation = service[method](project)
      const queued = service.calcChi2(project)
      const failures = Promise.all([
        expect(calculation).rejects.toBeInstanceOf(ComputeCancelled),
        expect(queued).rejects.toBeInstanceOf(ComputeCancelled),
      ])
      service.stop()
      expect(first.terminate).toHaveBeenCalledOnce()
      await failures
      expect(JSON.stringify(project)).toBe(before)
      const retry = service.calcChi2(project)
      deliverResult(second, 4)
      await expect(retry).resolves.toBe(4)
      service.dispose()
    },
  )

  it('does not extend the deadline or admit new work while stopping a fit', async () => {
    vi.useFakeTimers()
    const port = controlledWorker()
    const service = new WorkerComputeService(() => port)
    const progress = vi.fn()
    const fit = service.startFit(createDefaultProject(), progress)
    const failure = expect(fit).rejects.toBeInstanceOf(ComputeCancelled)
    const request = vi.mocked(port.postMessage).mock.calls[0][0]
    if (!('id' in request)) throw new Error('Expected a fit request')
    service.stopFit()
    vi.advanceTimersByTime(STOP_TIMEOUT_MS - 1)
    service.stop()
    await expect(service.calcChi2(createDefaultProject())).rejects.toBeInstanceOf(ComputeCancelled)
    port.onmessage?.({ data: { id: request.id, type: 'fitProgress', progress: { iteration: 1, chi2: 0, values: [42] } } } as MessageEvent<WorkerResponse>)
    expect(progress).not.toHaveBeenCalled()
    expect(port.terminate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await failure
    expect(port.terminate).toHaveBeenCalledOnce()
    expect(STOP_TIMEOUT_MS).toBeLessThan(1000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels live curves while preserving a cooperatively stopped fit result', async () => {
    vi.useFakeTimers()
    const port = controlledWorker()
    const service = new WorkerComputeService(() => port)
    const project = fitProject()
    const fit = service.startFit(project, () => {})
    const curve = service.calcChi2(project)
    const cancelledCurve = expect(curve).rejects.toBeInstanceOf(ComputeCancelled)
    service.stop()
    deliverResult(port, 999)
    await cancelledCurve
    const request = vi.mocked(port.postMessage).mock.calls[0][0]
    if (!('id' in request)) throw new Error('Expected a fit request')
    port.onmessage?.({ data: { id: request.id, type: 'result', result: {
      project, values: [49], iterations: 2, chi2: 1, stopped: false,
    } } } as MessageEvent<WorkerResponse>)
    await expect(fit).resolves.toMatchObject({ stopped: true, values: [49] })
    expect(port.terminate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    service.dispose()
  })

  it('does not run another optimizer step after the stop flag arrives', async () => {
    const messages: WorkerResponse[] = []
    const handle = createRequestHandler((response) => {
      messages.push(response)
      if (response.type === 'fitProgress') void handle({ kind: 'stopFit' })
    })
    await handle({ id: 1, kind: 'fit', project: fitProject() })
    const progress = messages.find((message) => message.type === 'fitProgress')
    const result = messages.find((message) => message.type === 'result')
    expect(progress?.type).toBe('fitProgress')
    if (progress?.type !== 'fitProgress') throw new Error('Expected progress')
    expect(result).toMatchObject({ result: { stopped: true, iterations: progress.progress.iteration } })
  })

})

describe('mock layer spectrum service', () => {
  it('passes loaded tables to the worker and returns the selected spectrum without changing the project', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    project.sample.layers[1].opticalTable = 'folder\\Co.db'
    const before = structuredClone(project)
    const tables = [
      { name: 'Co', kind: 'db' as const, energy: [700, 800], columns: [[0.1, 0.2], [0.03, 0.04]], warnings: [] },
      { name: 'Co', kind: 'm' as const, energy: [710, 810], columns: [[-0.01, 0.02], [0, -0.03]], warnings: [] },
    ]
    expect(await service.layerSpectrum(project, { layerIndex: 1, magnetic: false, tables })).toEqual({ energy: [700, 800], first: [0.1, 0.2], second: [0.03, 0.04] })
    expect(await service.layerSpectrum(project, { layerIndex: 1, magnetic: true, tables })).toEqual({ energy: [710, 810], first: [-0.01, 0.02], second: [0, -0.03] })
    expect(project).toEqual(before)
    service.dispose()
  })

  it('reports missing/empty tables and missing element selection', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    await expect(service.layerSpectrum(project, { layerIndex: 1, magnetic: false, tables: [] })).rejects.toThrow('Load Co.db')
    await expect(service.layerSpectrum(project, { layerIndex: 1, magnetic: true, tables: [{ name: 'Co', kind: 'm', energy: [], columns: [[], []], warnings: [] }] })).rejects.toThrow('Load Co.m')
    project.sample.mode = 'element'
    await expect(service.layerSpectrum(project, { layerIndex: 1, magnetic: false, tables: [] })).rejects.toThrow('Select an element')
    service.dispose()
  })
})

describe('mock element scattering-factor service', () => {
  it('selects the requested element table, omits zero energy and preserves the project', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    project.sample.mode = 'element'
    project.sample.elementProfiles = ['Co', 'Ni'].map(element => ({ element, f1: 1, f2: 2, f1Mag: 0, f2Mag: 0, slabs: [] }))
    const before = structuredClone(project)
    const tables = [
      { name: 'Co', kind: 'ff' as const, energy: [0, 700, 800], columns: [[99, -2, 3], [99, 0, 4]], warnings: [] },
      { name: 'Ni', kind: 'ff' as const, energy: [710, 810], columns: [[5, 6], [7, 8]], warnings: [] },
    ]
    expect(await service.scatteringFactors(project, { elementIndex: 0, tables })).toEqual({ energy: [700, 800], first: [-2, 3], second: [0, 4] })
    expect(await service.scatteringFactors(project, { elementIndex: 1, tables })).toEqual({ energy: [710, 810], first: [5, 6], second: [7, 8] })
    await expect(service.scatteringFactors(project, { elementIndex: 0, tables: [] })).rejects.toThrow('Load Co.ff')
    await expect(service.scatteringFactors(project, { elementIndex: 2, tables })).rejects.toThrow('Select an element')
    await expect(service.scatteringFactors(project, { elementIndex: 0, tables: [{ ...tables[0], columns: [[1], [2]] }] })).rejects.toThrow('invalid scattering-factor')
    expect(project).toEqual(before)
    service.dispose()
  })
})

describe('mock density-profile service', () => {
  it('returns every element on one depth grid with boundaries and responds to slab edits', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    project.sample.mode = 'element'
    project.sample.elementProfiles = ['Co', 'Ni'].map((element, index) => ({ element, f1: 1, f2: 2, f1Mag: 0, f2Mag: 0,
      slabs: [{ thickness: 0, density: 0.1, roughness: 0 }, { thickness: 20 + index * 10, density: 0.3, roughness: 0 }, { thickness: 0, density: 0, roughness: 0 }] }))
    const before = structuredClone(project)
    const profiles = await service.densityProfiles(project)
    expect(profiles.elements.map(element => element.name)).toEqual(['Co', 'Ni'])
    expect(profiles.elements[0].boundaries).toEqual([{ z: 0, density: 0.2 }, { z: 20, density: 0.15 }])
    expect(profiles.elements[1].boundaries).toEqual([{ z: 0, density: 0.2 }, { z: 30, density: 0.15 }])
    for (const element of profiles.elements) {
      expect(element.density).toHaveLength(profiles.z.length)
      expect(element.density[0]).toBe(0.1)
      expect(element.density.at(-1)).toBe(0)
      expect(element.density.every(Number.isFinite)).toBe(true)
    }
    expect(project).toEqual(before)
    project.sample.elementProfiles[0].slabs[1] = { thickness: 40, density: 0.6, roughness: 4 }
    const edited = await service.densityProfiles(project)
    expect(edited.elements[0].boundaries[1].z).toBe(40)
    expect(edited.elements[0].density.some(value => value > 0.3)).toBe(true)
    expect(edited.elements[0].density.some(value => value > 0 && value < 0.1)).toBe(true)
    project.sample.elementProfiles[0].slabs = []
    await expect(service.densityProfiles(project)).rejects.toThrow('substrate and ambient')
    project.sample.mode = 'compound'
    await expect(service.densityProfiles(project)).rejects.toThrow('Define elements')
    service.dispose()
  })
})

describe('mock database update service', () => {
  it('updates every matching layer, skips missing/out-of-range tables and preserves the source', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    project.experiment.energy = 750
    project.sample.layers = project.sample.layers.slice(0, 3)
    project.sample.layers.forEach((layer, index) => { layer.opticalTable = index === 2 ? 'Ni' : 'Co' })
    const before = structuredClone(project)
    const tables = [
      { name: 'Co', kind: 'db' as const, energy: [700, 800], columns: [[1, 3], [2, 4]], warnings: [] },
      { name: 'Co', kind: 'm' as const, energy: [700, 800], columns: [[-2, -4], [-4, -6]], warnings: [] },
      { name: 'Ni', kind: 'db' as const, energy: [900, 1000], columns: [[5, 6], [7, 8]], warnings: [] },
    ]
    const result = await service.databaseValues(project, tables)
    expect(result.updates).toEqual([0, 1].map(index => ({ index, first: 2, second: 3, firstMag: -3, secondMag: -5 })))
    expect(result.warnings).toEqual([expect.stringContaining('outside the db table')])
    expect((await service.databaseValues(project, [])).updates).toHaveLength(0)
    expect(project).toEqual(before)
    service.dispose()
  })

  it('updates all element factors and reports zero magnetic values when no magnetic table exists', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    project.sample.mode = 'element'
    project.experiment.energy = 750
    project.sample.elementProfiles = ['Co', 'Ni'].map(element => ({ element, f1: 99, f2: 99, f1Mag: 99, f2Mag: 99, slabs: [] }))
    const tables = ['Co', 'Ni'].map(name => ({ name, kind: 'ff' as const, energy: [700, 800], columns: [[1, 3], [2, 4]], warnings: [] }))
    const result = await service.databaseValues(project, tables)
    expect(result.mode).toBe('element')
    expect(result.updates).toEqual([0, 1].map(index => ({ index, first: 2, second: 3, firstMag: 0, secondMag: 0 })))
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings[0]).toContain('magnetic values set to zero')
    expect(project.sample.elementProfiles[0].f1).toBe(99)
    service.dispose()
  })
})

describe('mock dielectric tensor service', () => {
  it('returns all imported tensor components and interpolates a current-energy preview without mutating the project', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    project.experiment.energy = 750
    const before = structuredClone(project)
    const tables = [{ name: 'Co', kind: 'e' as const, energy: [700, 800], columns: Array.from({ length: 18 }, (_, index) => [index, index + 2]), warnings: [] }]
    const current = await service.dielectricTensor(project, { layerIndex: 1, tables, spectrum: false })
    expect(current).toMatchObject({ energy: [750], source: 'table' })
    expect(current.tensors[0]).toEqual(Array.from({ length: 9 }, (_, index) => ({ re: 2 * index + 1, im: 2 * index + 2 })))
    const spectrum = await service.dielectricTensor(project, { layerIndex: 1, tables, spectrum: true })
    expect(spectrum.energy).toEqual([700, 800])
    expect(spectrum.tensors[1][8]).toEqual({ re: 18, im: 19 })
    expect(project).toEqual(before)
    service.dispose()
  })

  it('provides responsive scalar previews with zero off-diagonals when unmagnetized and clear missing-grid errors', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    const query = { layerIndex: 1, tables: [], spectrum: false }
    const plain = (await service.dielectricTensor(project, query)).tensors[0]
    expect(plain[0]).toEqual(plain[4])
    expect(plain[0]).toEqual(plain[8])
    for (const index of [1, 2, 3, 5, 6, 7]) expect(plain[index]).toEqual({ re: 0, im: 0 })
    project.calculation.magnetization.mode = 'add'
    const magnetic = (await service.dielectricTensor(project, query)).tensors[0]
    expect(magnetic[2]).not.toEqual(plain[2])
    expect(magnetic[6].re).toBe(-magnetic[2].re)
    expect(magnetic[6].im).toBe(-magnetic[2].im)
    project.sample.layers[1].magnetization.phi = 0
    const rotated = (await service.dielectricTensor(project, query)).tensors[0]
    expect(rotated[2]).not.toEqual(magnetic[2])
    project.calculation.tensorContribution = 'tetragonal'
    const tetragonal = (await service.dielectricTensor(project, query)).tensors[0]
    expect(tetragonal[8]).not.toEqual(tetragonal[0])
    await expect(service.dielectricTensor(project, { ...query, spectrum: true })).rejects.toThrow('Load Co.e or .db')
    const fallback = await service.dielectricTensor(project, { ...query, spectrum: true, tables: [{ name: 'Co', kind: 'db', energy: [700, 800], columns: [[0.1, 0.2], [0, 0]], warnings: [] }] })
    expect(fallback.source).toBe('scalar')
    expect(fallback.tensors[0][0]).not.toEqual(fallback.tensors[1][0])
    service.dispose()
  })
})

describe('mock element optical spectrum', () => {
  it('uses the selected grid, all slab contributions, and rejects incomplete inputs without mutation', async () => {
    const service = new WorkerComputeService(inProcessWorker)
    const project = createDefaultProject()
    project.sample.mode = 'element'
    project.sample.elementProfiles = ['Co', 'Ni'].map(element => ({ element, f1: 99, f2: 99, f1Mag: 0, f2Mag: 0,
      slabs: [{ thickness: 0, density: 0.1, roughness: 0 }, { thickness: 20, density: 0.2, roughness: 0 }, { thickness: 0, density: 0, roughness: 0 }] }))
    const tables = [
      { name: 'Co', kind: 'ff' as const, energy: [0, 700, 800], columns: [[99, 2, 4], [99, 1, 2]], warnings: [] },
      { name: 'Ni', kind: 'ff' as const, energy: [710, 810], columns: [[3, 5], [4, 6]], warnings: [] },
    ]
    const before = structuredClone(project)
    const query = { elementIndex: 0, layerIndex: 1, magnetic: false, tables }
    const result = await service.layerSpectrum(project, query)
    expect(result.energy).toEqual([700, 800])
    expect(result.first.every(Number.isFinite)).toBe(true)
    const substrate = await service.layerSpectrum(project, { ...query, layerIndex: 0 })
    expect(result.first).toEqual(substrate.first.map(value => value * 2))
    expect(result.second).toEqual(substrate.second.map(value => value * 2))
    expect((await service.layerSpectrum(project, { ...query, layerIndex: 2 })).first).toEqual([0, 0])
    expect((await service.layerSpectrum(project, { ...query, elementIndex: 1 })).energy).toEqual([710, 810])
    await expect(service.layerSpectrum(project, { ...query, tables: tables.slice(0, 1) })).rejects.toThrow('Load Ni.ff')
    expect(project).toEqual(before)
    project.sample.elementProfiles[1].slabs = []
    await expect(service.layerSpectrum(project, query)).rejects.toThrow('Ni needs a valid density at slab 1')
    service.dispose()
  })
})

it('returns a bounded mock layer conversion without modifying source data', async () => {
  const service = new WorkerComputeService(inProcessWorker)
  const project = createDefaultProject()
  const before = structuredClone(project)
  const layers = await service.segmentLayers(project)
  expect(layers.length).toBeGreaterThan(project.sample.layers.length)
  expect(layers.length).toBeLessThan(1000)
  expect(layers.every(layer => layer.roughness === 0 && layer.opticalTable === 'unknown')).toBe(true)
  expect(layers.slice(1, -1).every(layer => layer.thickness > 0 && Number.isFinite(layer.delta))).toBe(true)
  expect(layers[0].delta).toBe(project.sample.layers[0].delta)
  expect(layers.at(-1)!.beta).toBe(project.sample.layers.at(-1)!.beta)
  expect(project).toEqual(before)
  project.sample.mode = 'element'
  await expect(service.segmentLayers(project)).rejects.toThrow('Switch to compound mode')
  service.dispose()
})

it('converts materials through the worker and reports unsupported formulas without changing the project', async () => {
  const service = new WorkerComputeService(inProcessWorker)
  const project = createDefaultProject()
  project.sample.layers[1].material = 'Invalid!'
  const before = structuredClone(project)
  const result = await service.materialToElements(project)
  expect(result.elements.length).toBeGreaterThan(0)
  expect(result.warnings.join(' ')).toContain('Layer 1 skipped')
  expect(project).toEqual(before)
  service.dispose()
})


it.each(['calcChi2', 'calcReflectivity', 'calcAsymmetry', 'calcEnergyScan', 'calcEnergyAsymmetry', 'startFit', 'layerSpectrum', 'dielectricTensor'] as const)('routes %s script messages only to their pending request and rejects late output after cancellation', async method => {
  const worker = controlledWorker()
  const service = new WorkerComputeService(() => worker)
  const lines = vi.fn()
  const request = method === 'dielectricTensor' ? service.dielectricTensor(createDefaultProject(), { layerIndex: 0, spectrum: true, tables: [] }, lines) : method === 'layerSpectrum' ? service.layerSpectrum(createDefaultProject(), { layerIndex: 0, magnetic: false, tables: [] }, lines) : method === 'startFit' ? service.startFit(createDefaultProject(), vi.fn(), lines) : service[method](createDefaultProject(), lines)
  const response = worker.onmessage!
  response({ data: { id: 1, type: 'scriptMessages', lines: ['running'] } } as MessageEvent<WorkerResponse>)
  response({ data: { id: 2, type: 'scriptMessages', lines: ['wrong request'] } } as MessageEvent<WorkerResponse>)
  expect(lines.mock.calls).toEqual([[['running']]])
  const rejected = expect(request).rejects.toBeInstanceOf(ComputeCancelled)
  service.stop()
  await rejected
  response({ data: { id: 1, type: 'scriptMessages', lines: ['late'] } } as MessageEvent<WorkerResponse>)
  expect(lines).toHaveBeenCalledTimes(1)
  service.dispose()
})
