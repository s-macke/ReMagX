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
  const load = vi.fn(async () => ({ calculate, fitError: vi.fn(), lookup: vi.fn(), energyScan: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), dielectricTensor: vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })), matrixQz: vi.fn() }))
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

it('converts materials without loading physics, retries failed initialization, and translates native errors', async () => {
  const messages: WorkerResponse[] = []
  const load = vi.fn().mockRejectedValueOnce(new Error('Module load failed')).mockResolvedValue({ calculate: () => { throw Object.assign(new Error(), { status: 4 }) }, fitError: vi.fn(), lookup: vi.fn(), energyScan: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), dielectricTensor: vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })), matrixQz: vi.fn() })
  const handle = createRealRequestHandler(message => messages.push(message), load)
  const project = createDefaultProject()
  await handle({ id: 1, kind: 'materialToElements', project })
  expect(load).not.toHaveBeenCalled()
  await handle({ id: 2, kind: 'reflectivity', project })
  await handle({ id: 3, kind: 'reflectivity', project })
  expect(load).toHaveBeenCalledTimes(2)
  expect(messages).toEqual([
    expect.objectContaining({ id: 1, type: 'result', result: expect.objectContaining({ elements: [
      expect.objectContaining({ element: 'Cu' }), expect.objectContaining({ element: 'Co' }),
    ] }) }),
    { id: 2, type: 'error', message: 'Module load failed' },
    { id: 3, type: 'error', message: 'Qz exceeds the legacy calculation boundary. Check the qz values and energy; the incident angle cannot exceed 90 degrees.' },
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
  const handle = createRealRequestHandler(send, async () => ({ calculate, lookup, fitError: vi.fn(), energyScan: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(), dielectricTensor: vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })), matrixQz: vi.fn() }))
  const tables = [{ name: 'sample', kind: 'db' as const, energy: [600, 700], columns: [[0, 1], [0, 1]], warnings: [] }]
  await handle({ id: 1, kind: 'reflectivity', project, tables })
  expect(lookup.mock.calls[0]).toEqual([tables[0], [12398.326 / (12398.326 / project.experiment.energy)], 0])
  expect(calculate.mock.calls[0][0].layers.every(layer => layer[2] === .01 && layer[3] === .002 && layer[4] === 0 && layer[5] === 0)).toBe(true)
  expect(project).toEqual(before)
  await handle({ id: 2, kind: 'reflectivity', project })
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ id: 2, type: 'error', message: expect.stringContaining('missing optical table') })
  expect(calculate).toHaveBeenCalledTimes(1)
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
  // GetState builds the tensor state once; matrix packing retains its classification.
  expect(dielectricTensor).toHaveBeenCalledTimes(project.sample.layers.length)
  expect(send.mock.calls[0][0]).toMatchObject({ type: 'result', result: { asymmetry: [.5, 0] } })
})

it('routes Zak requests to the scalar solver after standalone energy GetState preparation', async () => {
  const project = createDefaultProject()
  project.calculation.algorithm = 'zak'
  project.experiment.qzScan.points = 2
  project.experiment.energyScan.energyMin = 100
  project.experiment.energyScan.energyMax = 200
  project.sample.layers.forEach(layer => { layer.opticalTable = 'sample' })
  const send = vi.fn(), calculate = vi.fn(), dielectricTensor = vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })), matrixQz = vi.fn()
  const zakQz = vi.fn(() => new Float64Array([3, 1, 2, 2]))
  const zakEnergy = vi.fn(() => new Float64Array([3, 1, 2, 2, 1, 3]))
  const lookup = vi.fn(() => ({ values: new Float64Array([.01, .002]), cursor: 0 }))
  const handle = createRealRequestHandler(send, async () => ({ calculate, dielectricTensor, matrixQz,
    zakQz, zakEnergy, lookup, fitError: vi.fn(), matrixEnergy: vi.fn(), energyScan: vi.fn() }))
  await handle({ id: 1, kind: 'asymmetry', project })
  expect(dielectricTensor).toHaveBeenCalledTimes(project.sample.layers.length)
  project.experiment.energy = 150 // SetOCStrict validates the initial energy too.
  const tables = [{ name: 'sample', kind: 'db' as const, energy: [90, 210], columns: [[.01, .01], [.002, .002]], warnings: [] }]
  await handle({ id: 2, kind: 'energyAsymmetry', project, tables })
  expect(zakQz).toHaveBeenCalledTimes(1)
  expect(zakEnergy).toHaveBeenCalledTimes(1)
  expect(calculate).not.toHaveBeenCalled()
  expect(dielectricTensor).toHaveBeenCalledTimes(2 * project.sample.layers.length)
  expect(matrixQz).not.toHaveBeenCalled()
  expect(send.mock.calls[0][0]).toMatchObject({ type: 'result', result: { asymmetry: [.5, 0] } })
  expect(send.mock.calls[1][0]).toMatchObject({ type: 'result', result: { asymmetry: [.5, 0, -.5] } })
})


it('reports deferred algorithms before loading physics or running scripts across calculation and fit requests', async () => {
  const load = vi.fn(), createLuaSession = vi.fn(), send = vi.fn()
  const handle = createRealRequestHandler(send, load, createLuaSession)
  const project = createDefaultProject()
  project.scripts.beforeCalculation = 'error("must not execute")'
  for (const [algorithm, label] of [
    ['parratt-single-scattering', 'Parratt without multiple scattering'],
    ['electron-yield', 'Total electron yield'],
  ] as const) {
    project.calculation.algorithm = algorithm
    const snapshot = structuredClone(project)
    for (const kind of ['reflectivity', 'asymmetry', 'energyScan', 'energyAsymmetry', 'chi2', 'fit'] as const) {
      await handle({ id: 123, kind, project })
      expect(send).toHaveBeenLastCalledWith({ id: 123, type: 'error',
        message: `${label} is planned for a later release and is not available in the real engine.` })
    }
    expect(project).toEqual(snapshot)
  }
  expect(load).not.toHaveBeenCalled()
  expect(createLuaSession).not.toHaveBeenCalled()
})


it.each([
  [Object.assign(new Error('native status'), { status: 1 }), 'The real engine rejected invalid calculation inputs. Check the calculation parameters.\nnative status'],
  [Object.assign(new Error('native status'), { status: 2 }), 'The real engine produced a nonfinite numerical result. Check the optical constants and calculation parameters.\nnative status'],
  [Object.assign(new Error('native status'), { status: 3 }), 'The real engine could not allocate calculation memory. Reduce the scan point count or layer count and try again.\nnative status'],
  [new Error(''), 'The real engine calculation failed.'],
  [new Error('  \n '), 'The real engine calculation failed.'],
  [null, 'The real engine calculation failed.'],
  [{ status: 99 }, 'The real engine calculation failed.'],
  ['Calculation interrupted by the module loader.', 'Calculation interrupted by the module loader.'],
  [new Error('BeforeCalculation:12: invalid layer index'), 'BeforeCalculation:12: invalid layer index'],
])('reports calculation failures and allows the next request to recover: %s', async (failure, expected) => {
  const project = createDefaultProject()
  project.experiment.qzScan.points = 2
  const original = structuredClone(project)
  const calculate = vi.fn<RealQzCalculator>()
    .mockImplementationOnce(() => { throw failure })
    .mockReturnValue(new Float64Array([1, 1, .5, .5]))
  const send = vi.fn()
  const handle = createRealRequestHandler(send, async () => ({ calculate, fitError: vi.fn(), lookup: vi.fn(),
    energyScan: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(),
    dielectricTensor: vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })), matrixQz: vi.fn() }))
  await handle({ id: 1, kind: 'reflectivity', project })
  expect(send.mock.calls.at(-1)?.[0]).toEqual({ id: 1, type: 'error', message: expected })
  await handle({ id: 2, kind: 'reflectivity', project })
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ id: 2, type: 'result', result: { reflectivity: [1, .5] } })
  expect(project).toEqual(original)
})


it('owns separate table sessions per request and disposes them after success or errors', async () => {
  const project = createDefaultProject()
  project.experiment.qzScan.points = 2
  project.experiment.energy = 650
  project.calculation.automaticOpticalConstants = true
  project.sample.layers.forEach(layer => { layer.opticalTable = 'sample' })
  const sessions: { lookup: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = []
  const baseLookup = vi.fn()
  const createLookupSession = () => {
    const value = { lookup: vi.fn(() => ({ values: new Float64Array([.01, .002]), cursor: 1 })), dispose: vi.fn() }
    sessions.push(value); return value
  }
  let fail = false
  const calculate = vi.fn((request: Parameters<RealQzCalculator>[0]) => {
    if (fail) throw new Error('Calculation failed')
    return new Float64Array(request.qz.flatMap(() => [1, 1]))
  })
  const send = vi.fn()
  const handle = createRealRequestHandler(send, async () => ({ createLookupSession, calculate, lookup: baseLookup,
    fitError: vi.fn(), energyScan: vi.fn(), matrixEnergy: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(),
    dielectricTensor: vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })), matrixQz: vi.fn() }))
  const tables = [{ name: 'sample', kind: 'db' as const, energy: [600, 700], columns: [[0, 1], [0, 1]], warnings: [] }]
  await handle({ id: 1, kind: 'reflectivity', project, tables })
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'result' })
  fail = true
  await handle({ id: 2, kind: 'reflectivity', project, tables })
  expect(sessions).toHaveLength(2)
  for (const session of sessions) {
    expect(session.lookup).toHaveBeenCalled()
    expect(session.dispose).toHaveBeenCalledTimes(1)
  }
  expect(baseLookup).not.toHaveBeenCalled()
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'error' })
})
