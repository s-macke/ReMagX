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
  const load = vi.fn(async () => calculate)
  const handle = createRealRequestHandler(send, load)
  const project = createDefaultProject()
  project.experiment.qzScan.points = 2
  project.experiment.resolution.fastConvolution = false
  await Promise.all([handle({ id: 1, kind: 'reflectivity', project }), handle({ id: 2, kind: 'asymmetry', project })])
  expect(load).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][0]).toMatchObject({ id: 1, type: 'result', result: { reflectivity: [3, 3] } })
  expect(send.mock.calls[1][0]).toMatchObject({ id: 2, type: 'result', result: { asymmetry: [.5, .5] } })
  expect(calculate.mock.calls.map(([request]) => request.mode)).toEqual([0, 1])
})

it('rejects unsupported work before loading, retries failed initialization, and translates native errors', async () => {
  const messages: WorkerResponse[] = []
  const load = vi.fn().mockRejectedValueOnce(new Error('Module load failed')).mockResolvedValue(() => { throw Object.assign(new Error(), { status: 4 }) })
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
