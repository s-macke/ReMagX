import { expect, it, vi } from 'vitest'
import { createDefaultProject } from '../model/defaults'
import { unpackParrattResult } from '../model/parrattResult'
import { createRealRequestHandler, type RealQzCalculator } from './realEngine'
import type { WorkerResponse } from './protocol'

it('unpacks both asymmetry definitions and zero sums without altering inputs', () => {
  const values = new Float64Array([3, 1, 0, 0, -1, 1])
  expect(unpackParrattResult([1, 2, 3], values, 'normalized').asymmetry).toEqual([.5, 0, 0])
  expect(unpackParrattResult([1, 2, 3], values, 'difference').asymmetry).toEqual([2, 0, -2])
  expect(() => unpackParrattResult([1], values, 'normalized')).toThrow('invalid')
  expect(() => unpackParrattResult([1], new Float64Array([NaN, 0]), 'normalized')).toThrow('invalid')
})

it('prepares and routes requests, shares initialization, and returns the established result shape', async () => {
  const send = vi.fn()
  const calculate = vi.fn((request: Parameters<RealQzCalculator>[0]) => new Float64Array(request.qz.flatMap(() => [3, 1])))
  const load = vi.fn(async () => ({ calculate, fitError: vi.fn(), lookup: vi.fn(), energyScan: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), dielectricTensor: vi.fn(), matrixQz: vi.fn() }))
  const handle = createRealRequestHandler(send, load)
  const project = createDefaultProject()
  project.experiment.qzScan.points = 2
  project.experiment.resolution.fastConvolution = false
  project.experiment.resolution.angularFwhm = .001
  await Promise.all([handle({ id: 1, kind: 'reflectivity', project }), handle({ id: 2, kind: 'asymmetry', project })])
  expect(load).toHaveBeenCalledTimes(1)
  expect(calculate.mock.calls[0][0].resolution).toEqual({ width: .001, fast: false })
  expect(calculate.mock.calls[0][0].qz).toHaveLength(2)
  expect(send.mock.calls[0][0]).toMatchObject({ id: 1, type: 'result', result: { reflectivity: [3, 3] } })
  expect(send.mock.calls[1][0]).toMatchObject({ id: 2, type: 'result', result: { asymmetry: [.5, .5] } })
  expect(calculate.mock.calls.map(([request]) => request.mode)).toEqual([0, 1])
})

it('rejects unsupported work before loading, retries failed initialization, and translates native errors', async () => {
  const messages: WorkerResponse[] = []
  const load = vi.fn().mockRejectedValueOnce(new Error('Module load failed')).mockResolvedValue({ calculate: () => { throw Object.assign(new Error(), { status: 4 }) }, fitError: vi.fn(), lookup: vi.fn(), energyScan: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), dielectricTensor: vi.fn(), matrixQz: vi.fn() })
  const handle = createRealRequestHandler(message => messages.push(message), load)
  const project = createDefaultProject()
  await handle({ id: 1, kind: 'depthProfile', project })
  expect(load).not.toHaveBeenCalled()
  await handle({ id: 2, kind: 'reflectivity', project })
  await handle({ id: 3, kind: 'reflectivity', project })
  expect(load).toHaveBeenCalledTimes(2)
  expect(messages).toEqual([
    { id: 1, type: 'error', message: 'The real engine does not support depthProfile yet.' },
    { id: 2, type: 'error', message: 'Module load failed' },
    { id: 3, type: 'error', message: 'Qz exceeds the legacy calculation boundary.' },
  ])
})

it('refreshes only the worker snapshot, using the legacy wavelength round trip before calculation', async () => {
  const project = createDefaultProject()
  project.calculation.automaticOpticalConstants = true
  project.experiment.energy = 643.123
  project.experiment.qzScan.points = 2
  project.sample.layers.forEach(layer => { layer.opticalTable = 'sample' })
  const before = structuredClone(project)
  const lookup = vi.fn(() => ({ values: new Float64Array([.01, .002]), cursor: 1 }))
  const calculate = vi.fn((request: Parameters<RealQzCalculator>[0]) => new Float64Array(request.qz.flatMap(() => [1, 1])))
  const send = vi.fn()
  const handle = createRealRequestHandler(send, async () => ({ calculate, lookup, fitError: vi.fn(), energyScan: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), dielectricTensor: vi.fn(), matrixQz: vi.fn() }))
  const tables = [{ name: 'sample', kind: 'db' as const, energy: [600, 700], columns: [[0, 1], [0, 1]], warnings: [] }]
  await handle({ id: 1, kind: 'reflectivity', project, tables })
  expect(lookup.mock.calls[0]).toEqual([tables[0], [12398.326 / (12398.326 / project.experiment.energy)], 0])
  expect(calculate.mock.calls[0][0].layers.every(layer => layer[2] === .01 && layer[3] === .002 && layer[4] === 0 && layer[5] === 0)).toBe(true)
  expect(project).toEqual(before)
  await handle({ id: 2, kind: 'reflectivity', project })
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ id: 2, type: 'result' })
  expect(calculate).toHaveBeenCalledTimes(2)
  expect(calculate.mock.calls[1][0].layers.map(layer => layer[2])).toEqual(project.sample.layers.map(layer => layer.delta))
})

it('routes matrix qz requests through tensor preparation and preserves asymmetry postprocessing', async () => {
  const project = createDefaultProject()
  project.calculation.algorithm = 'matrix'
  project.experiment.qzScan.points = 2
  const send = vi.fn()
  const calculate = vi.fn()
  const matrixQz = vi.fn(() => new Float64Array([3, 1, 2, 2]))
  const dielectricTensor = vi.fn(() => ({ values: new Float64Array(18), anisotropic: false }))
  const handle = createRealRequestHandler(send, async () => ({ calculate, matrixQz, dielectricTensor, fitError: vi.fn(), lookup: vi.fn(), energyScan: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn() }))
  await handle({ id: 1, kind: 'asymmetry', project })
  expect(calculate).not.toHaveBeenCalled()
  expect(matrixQz).toHaveBeenCalledTimes(1)
  expect(dielectricTensor).toHaveBeenCalledTimes(project.sample.layers.length)
  expect(send.mock.calls[0][0]).toMatchObject({ type: 'result', result: { asymmetry: [.5, 0] } })
})

it('routes Zak qz and energy requests without tensor construction or Parratt fallback', async () => {
  const project = createDefaultProject()
  project.calculation.algorithm = 'zak'
  project.experiment.qzScan.points = 2
  project.experiment.energyScan.energyMin = 100
  project.experiment.energyScan.energyMax = 200
  project.sample.layers.forEach(layer => { layer.opticalTable = 'sample' })
  const send = vi.fn(), calculate = vi.fn(), dielectricTensor = vi.fn(), matrixQz = vi.fn()
  const zakQz = vi.fn(() => new Float64Array([3, 1, 2, 2]))
  const zakEnergy = vi.fn(() => new Float64Array([3, 1, 2, 2, 1, 3]))
  const lookup = vi.fn(() => ({ values: new Float64Array([.01, .002]), cursor: 0 }))
  const handle = createRealRequestHandler(send, async () => ({ calculate, dielectricTensor, matrixQz,
    zakQz, zakEnergy, lookup, fitError: vi.fn(), matrixEnergy: vi.fn(), energyScan: vi.fn() }))
  await handle({ id: 1, kind: 'asymmetry', project })
  const tables = [{ name: 'sample', kind: 'db' as const, energy: [90, 210], columns: [[.01, .01], [.002, .002]], warnings: [] }]
  await handle({ id: 2, kind: 'energyAsymmetry', project, tables })
  expect(zakQz).toHaveBeenCalledTimes(1)
  expect(zakEnergy).toHaveBeenCalledTimes(1)
  expect(calculate).not.toHaveBeenCalled()
  expect(dielectricTensor).not.toHaveBeenCalled()
  expect(matrixQz).not.toHaveBeenCalled()
  expect(send.mock.calls[0][0]).toMatchObject({ type: 'result', result: { asymmetry: [.5, 0] } })
  expect(send.mock.calls[1][0]).toMatchObject({ type: 'result', result: { asymmetry: [.5, 0, -.5] } })
})
