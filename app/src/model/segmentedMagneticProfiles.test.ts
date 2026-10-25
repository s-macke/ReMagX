import { describe, expect, it, vi } from 'vitest'
import { applySegmentedMagneticProfiles, type MagneticProfileEngine } from './segmentedMagneticProfiles'
import type { PreparedCompoundLayer } from './compoundLayers'
import type { Project } from './project'

const profile = (binding: number | null): Project['sample']['depthProfileFunctions'][number] => ({
  center: 3, width: 2, deltaAmplitude: 4, betaAmplitude: 5, boundToLayer: binding,
  amplitudeCoupledTo: 0, widthCoupledTo: 0, spline: { enabled: false, points: [] },
})
const layers: PreparedCompoundLayer[] = Array.from({ length: 4 }, () => [2, 0, 1, 2, 3, 4, 90, 90])
const table = Array(1001).fill(0)
const invoke = (profiles: ReturnType<typeof profile>[], engine: MagneticProfileEngine, additive = true) =>
  applySegmentedMagneticProfiles(layers, [-2, 2, 6, 10], [0, 7, 7], [1, 2, 0], profiles, additive, table, engine, 3)

describe('segmented magnetic profile preparation', () => {
  it('uses original reversed bindings, generated midpoints and sample-major weights without changing inputs', () => {
    const density = vi.fn(({ layerIndex }) => Float64Array.from([layerIndex, layerIndex + 1, layerIndex + 2]))
    const apply = vi.fn<MagneticProfileEngine['apply']>(() => Float64Array.from([10, 11, 12, 13, 14, 15]))
    const before = structuredClone(layers)
    const result = invoke([profile(null), profile(0), profile(2)], { density, apply }, false)
    expect(density.mock.calls.map(([request]) => request.layerIndex)).toEqual([2, 0])
    expect(apply.mock.calls[0]).toEqual([{ profiles: Array(3).fill([3, 2, 4, 5]), splines: [null, null, null],
      positions: [0, 4, 8], initialValues: [3, 4, 3, 4, 3, 4], weights: [[1, 2, 0], [1, 3, 1], [1, 4, 2]], coupled: 1 }])
    expect(result[0]).toEqual(before[0])
    expect(result.slice(1).map(row => row.slice(4, 6))).toEqual([[10, 11], [12, 13], [14, 15]])
    expect(layers).toEqual(before)
    expect(result[0]).not.toBe(layers[0])
  })
  it('disables stored none and zero amplitudes, rejecting unknown active bindings', () => {
    const engine = { density: vi.fn(), apply: vi.fn() }
    expect(invoke([profile(3), { ...profile(100), deltaAmplitude: 0, betaAmplitude: 0 }], engine)).toEqual(layers)
    expect(engine.apply).not.toHaveBeenCalled()
    expect(() => invoke([profile(4)], engine)).toThrow('outside the stored layer choices')
    expect(engine.density).not.toHaveBeenCalled()
  })
  it('keeps none disabled when repetition makes its old density index valid', () => {
    const engine = { density: vi.fn(), apply: vi.fn() }
    const profiles = [profile(3)]
    const before = structuredClone(profiles)
    for (const additive of [false, true]) {
      expect(applySegmentedMagneticProfiles(layers, [-2, 2, 6, 10],
        [0, 7, 7, 14, 14], [1, 2, 0, 2, 0], profiles, additive, table, engine, 3)).toEqual(layers)
      expect(() => applySegmentedMagneticProfiles(layers, [-2, 2, 6, 10],
        [0, 7, 7, 14, 14], [1, 2, 0, 2, 0], [profile(4)], additive, table, engine, 3))
        .toThrow('outside the stored layer choices')
    }
    expect(engine.density).not.toHaveBeenCalled()
    expect(engine.apply).not.toHaveBeenCalled()
    expect(profiles).toEqual(before)
  })
  it('passes spline shapes and additive mode, rejecting invalid engine output atomically', () => {
    const apply = vi.fn<MagneticProfileEngine['apply']>(() => new Float64Array(6))
    const spline = { ...profile(null), spline: { enabled: true, points: [{ z: 2, value: 3 }] } }
    invoke([spline], { density: vi.fn(), apply })
    expect(apply.mock.calls[0][0]).toMatchObject({ coupled: 0, splines: [{ knots: [2], values: [3] }] })
    expect(() => invoke([profile(null)], { density: vi.fn(), apply: () => new Float64Array([NaN]) })).toThrow('application output')
    expect(() => invoke([profile(0)], { density: () => new Float64Array(0), apply })).toThrow('density weights')
    expect(layers[1][4]).toBe(3)
  })
})
