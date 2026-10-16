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
  const load = vi.fn(async () => ({ calculate, lookup: vi.fn(), energyScan: vi.fn() }))
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
  const load = vi.fn().mockRejectedValueOnce(new Error('Module load failed')).mockResolvedValue({ calculate: () => { throw Object.assign(new Error(), { status: 4 }) }, lookup: vi.fn(), energyScan: vi.fn() })
  const handle = createRealRequestHandler(message => messages.push(message), load)
  const project = createDefaultProject()
  await handle({ id: 1, kind: 'fit', project })
  expect(load).not.toHaveBeenCalled()
  await handle({ id: 2, kind: 'reflectivity', project })
  await handle({ id: 3, kind: 'reflectivity', project })
  expect(load).toHaveBeenCalledTimes(2)
  expect(messages).toEqual([
    { id: 1, type: 'error', message: 'The real engine does not support fit yet.' },
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
  const handle = createRealRequestHandler(send, async () => ({ calculate, lookup, energyScan: vi.fn() }))
  const tables = [{ name: 'sample', kind: 'db' as const, energy: [600, 700], columns: [[0, 1], [0, 1]], warnings: [] }]
  await handle({ id: 1, kind: 'reflectivity', project, tables })
  expect(lookup.mock.calls[0]).toEqual([tables[0], [12398.326 / (12398.326 / project.experiment.energy)], 0])
  expect(calculate.mock.calls[0][0].layers.every(layer => layer[2] === .01 && layer[3] === .002 && layer[4] === 0 && layer[5] === 0)).toBe(true)
  expect(project).toEqual(before)
  await handle({ id: 2, kind: 'reflectivity', project })
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ id: 2, type: 'error' })
  expect(calculate).toHaveBeenCalledTimes(1)
})
