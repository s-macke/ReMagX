import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../model/defaults'
import type { Project } from '../model/project'
import { calcReflectivity } from './mockPhysics'
import { createRequestHandler } from './mockEngine'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { WorkerComputeService, type WorkerPort } from './WorkerComputeService'

// Runs the worker-side handler in-process, with structuredClone standing in for the message copy.
function inProcessWorker(): WorkerPort {
  const port: WorkerPort = {
    onmessage: null,
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

describe('WorkerComputeService with the mock engine', () => {
  it('returns a reflectivity curve', async () => {
    const service = new WorkerComputeService(inProcessWorker())
    const curve = await service.calcReflectivity(createDefaultProject())
    expect(curve.qz).toHaveLength(300)
  })

  it('turns engine errors into rejected promises with the message', async () => {
    const service = new WorkerComputeService(inProcessWorker())
    const project = createDefaultProject()
    project.experiment.qzScan.qzMax = 50
    await expect(service.calcReflectivity(project)).rejects.toThrow(/above 90°/)
  })

  it('fits a layer thickness back to the true value and reports progress', async () => {
    const service = new WorkerComputeService(inProcessWorker())
    const progress: number[] = []
    const result = await service.startFit(fitProject(), (p) => progress.push(p.chi2))
    expect(result.stopped).toBe(false)
    expect(result.project.sample.layers[1].thickness).toBeCloseTo(50, 2)
    expect(progress.length).toBeGreaterThan(2)
  })

  it('stops a running fit within one second', async () => {
    const service = new WorkerComputeService(inProcessWorker())
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

  it('rejects fit targets the mock does not support', async () => {
    const service = new WorkerComputeService(inProcessWorker())
    const project = fitProject()
    project.fit.parameters[0] = { ...project.fit.parameters[0], target: 'elementF1' }
    await expect(service.startFit(project, () => {})).rejects.toThrow(/elementF1/)
  })
})
