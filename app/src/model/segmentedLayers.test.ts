import { expect, it, vi } from 'vitest'
import { prepareSegmentedLayers, type SegmentationEngine } from './segmentedLayers'
import { createDefaultProject } from './defaults'
import type { PreparedCompoundLayer } from './compoundLayers'

const layers = (): PreparedCompoundLayer[] => [[999, 11, 1, 2, 3, 4, 12, 34], [7, 12, 2, 3, 4, 5, 56, 78], [999, 100, 0, 0, 0, 0, 0, 0]]
const settings = () => createDefaultProject().calculation.segmentation
const output = (width: number) => ({ positions: new Float64Array([0, 1, 2]), thicknesses: new Float64Array([0, 1, 1]), values: new Float64Array(3 * width).fill(2) })

it('prepares legacy depth limits, model IDs, reset layer metadata and outer tensor classifications', () => {
  const source = layers(), before = structuredClone(source)
  for (const scope of ['global', 'local'] as const) for (const active of [0, 2]) {
    const tensors = source.map((_, index) => ({ values: new Float64Array(18), anisotropic: index === active }))
    const generated = output(22)
    const sample = vi.fn<SegmentationEngine['sample']>(() => ({ opticalConstants: new Float64Array([1, 2, 3, 4]), dielectricTensor: new Float64Array(18).fill(5) }))
    const subdivide: SegmentationEngine['subdivide'] = request => {
      expect(request).toMatchObject({ minimumDepth: -33, maximumDepth: 43, valueCount: 22, capacity: 1000000 })
      expect(request.sample(1, 0)).toHaveLength(22)
      return generated
    }
    const result = prepareSegmentedLayers(source, { ...settings(), scope }, Array(1001).fill(0), { sample, subdivide }, tensors)
    expect(sample.mock.calls[0][0].model).toBe(scope === 'global' ? 1 : 2)
    expect(result.layers).toEqual([[0, 0, 2, 2, 2, 2, 90, 90], [1, 0, 2, 2, 2, 2, 90, 90], [1, 0, 2, 2, 2, 2, 90, 90]])
    expect(result.dielectricTensors.map(tensor => tensor!.anisotropic)).toEqual([false, active === 0, false])
    generated.values.fill(99)
    expect(result.dielectricTensors[1]!.values[0]).toBe(2)
  }
  expect(source).toEqual(before)
})

it('keeps four independent tensor histories and copies reused engine buffers', () => {
  const shared = new Float64Array(18)
  const sample: SegmentationEngine['sample'] = request => {
    shared.fill((request.tensorState?.[0] ?? 0) + 1)
    return { opticalConstants: new Float64Array(4), dielectricTensor: shared }
  }
  const subdivide: SegmentationEngine['subdivide'] = request => {
    expect([request.sample(0, 0)[4], request.sample(0, 1)[4], request.sample(1, 0)[4], request.sample(1, 2)[4], request.sample(2, 0)[4]])
      .toEqual([1, 1, 2, 1, 3])
    return output(22)
  }
  prepareSegmentedLayers(layers(), settings(), Array(1001).fill(0), { sample, subdivide }, layers().map(() => ({ values: new Float64Array(18), anisotropic: false })))
})

it('keeps scalar-only segmentation and the strict roughness threshold independent of unused fields', () => {
  const source = layers(); source[0][1] = 10; source[1][1] = 10
  const sample: SegmentationEngine['sample'] = request => {
    expect(request.tensors).toBeNull(); expect(request.tensorState).toBeNull()
    return { opticalConstants: new Float64Array(4), dielectricTensor: null }
  }
  const subdivide: SegmentationEngine['subdivide'] = request => {
    expect(request).toMatchObject({ minimumDepth: -30, maximumDepth: 37, valueCount: 4 })
    expect(request.sample(0, 0)).toHaveLength(4)
    return output(4)
  }
  const result = prepareSegmentedLayers(source, settings(), Array(1001).fill(0), { sample, subdivide })
  expect(result.dielectricTensors).toEqual([null, null, null])
})

it('rejects invalid preparation, callback results and generated output', () => {
  const sample = vi.fn<SegmentationEngine['sample']>(() => ({ opticalConstants: new Float64Array(3), dielectricTensor: null }))
  const subdivide: SegmentationEngine['subdivide'] = request => { request.sample(0, 0); return output(4) }
  const run = (source = layers(), configuration = settings(), table = Array(1001).fill(0)) => prepareSegmentedLayers(source, configuration, table, { sample, subdivide })
  expect(() => run([], settings())).toThrow('input')
  expect(() => run(layers(), { ...settings(), minThickness: 0 })).toThrow('input')
  expect(() => run(layers(), settings(), Array(1000).fill(0))).toThrow('input')
  const overflow = layers(); overflow[0][1] = 1e308
  expect(() => run(overflow)).toThrow('overflow')
  expect(sample).not.toHaveBeenCalled()
  expect(() => run()).toThrow('optical sample')
  expect(() => prepareSegmentedLayers(layers(), settings(), Array(1001).fill(0), { sample, subdivide: () => output(3) })).toThrow('output')
  expect(() => prepareSegmentedLayers(layers(), settings(), Array(1001).fill(0), { sample, subdivide: request => { request.sample(0, 4); return output(4) } })).toThrow('slot')
})


it('owns one prepared sampler across subdivision and disposes it after success or failure', () => {
  for (const fails of [false, true]) {
    const dispose = vi.fn()
    const sample = vi.fn(() => ({ opticalConstants: new Float64Array(4), dielectricTensor: null }))
    const prepareSampler = vi.fn(() => ({ sample, dispose }))
    const fallback = vi.fn()
    const engine: SegmentationEngine = { sample: fallback, prepareSampler, subdivide: request => {
      request.sample(1, 0); request.sample(2, 1)
      if (fails) throw new Error('subdivision failure')
      return output(4)
    } }
    const run = () => prepareSegmentedLayers(layers(), settings(), Array(1001).fill(0), engine)
    if (fails) expect(run).toThrow('subdivision failure')
    else expect(run().layers).toHaveLength(3)
    expect(prepareSampler).toHaveBeenCalledTimes(1)
    expect(sample.mock.calls).toEqual([[1, null], [2, null]])
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(fallback).not.toHaveBeenCalled()
  }
})
