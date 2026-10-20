import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { refreshElementOptics } from './refreshElementOptics'
import type { OpticalTable } from '../import/tables'
import type { RealTableLookup } from './refreshOpticalConstants'
import type { ScatteringTensorCalculator } from './scatteringTensors'

const table = (name: string, kind: OpticalTable['kind'], energy = [100, 200]): OpticalTable =>
  ({ name, kind, energy, columns: [], warnings: [] })
function fixture() {
  const project = createDefaultProject(); project.sample.mode = 'element'
  project.sample.elementProfiles = ['Fe', 'Fe', 'fe', 'Co'].map(element => ({ element, f1: 7, f2: 8, f1Mag: 9, f2Mag: 10, slabs: [] }))
  project.calculation.magnetization.direction = { gamma: 12, phi: 34 }
  return project
}

it('refreshes exact-name matches with shared cursors, constructs tensors, and retains missing/out-of-range profiles', () => {
  const project = fixture(); project.calculation.tensorContribution = 'tetragonal'
  const tables = [table('Fe', 'ff'), table('Fe', 'ffm', [300, 400]), table('Co', 'ff', [300, 400]), table('Fe', 'e')]
  const before = structuredClone(project)
  const previous = project.sample.elementProfiles.map((_, index) => new Float64Array(18).fill(index + 1))
  const lookup = vi.fn<RealTableLookup>((source, energy, cursor) => {
    expect(energy).toEqual([150])
    return { values: new Float64Array(source.kind === 'ffm' ? [0, 0] : [cursor + 20, 2]), cursor: cursor + 1 }
  })
  const construct = vi.fn<ScatteringTensorCalculator>(request => new Float64Array(18).fill(request.factors[0]))
  const result = refreshElementOptics(project, tables, 150, lookup, construct, new Map(), previous)
  expect(result.updated).toEqual([true, true, false, false])
  expect(result.elementProfiles.map(row => row.f1)).toEqual([20, 21, 7, 7])
  expect(result.elementProfiles[0]).toMatchObject({ f1Mag: 0, f2Mag: 0 })
  expect(lookup.mock.calls.map(([source, , cursor]) => [source.kind, cursor])).toEqual([['ff', 0], ['ffm', 0], ['ff', 1], ['ffm', 1]])
  expect(construct.mock.calls[0][0]).toEqual({ factors: [20, 2, 0, 0], gamma: 12, phi: 34, magnetic: 0, tensor: 1 })
  expect(result.scatteringTensors.map(row => row[0])).toEqual([20, 21, 3, 4])
  expect(result.rangeError).toContain('outside Co.ff')
  result.scatteringTensors[2][0] = 99
  expect(previous[2][0]).toBe(3)
  expect(project).toEqual(before)
})

it('initializes missing tensors to zero and retains earlier refreshes on later range failures', () => {
  const project = fixture(); project.sample.elementProfiles = project.sample.elementProfiles.slice(0, 1)
  const tables = [table('Fe', 'ff'), table('Fe', 'ffm', [])]
  const construct = vi.fn(() => new Float64Array(18).fill(5))
  const lookup = vi.fn(() => ({ values: new Float64Array([26, 1]), cursor: 3 }))
  expect(refreshElementOptics(project, [], 150, lookup, construct).scatteringTensors[0]).toEqual(new Float64Array(18))
  expect(construct).not.toHaveBeenCalled()
  const first = refreshElementOptics(project, tables, 150, lookup, construct)
  const current = { ...project, sample: { ...project.sample, elementProfiles: first.elementProfiles } }
  const second = refreshElementOptics(current, tables, 250, lookup, construct, new Map(), first.scatteringTensors)
  expect(second.elementProfiles[0]).toMatchObject({ f1: 26, f2: 1, f1Mag: 0, f2Mag: 0 })
  expect(second.scatteringTensors).toEqual(first.scatteringTensors)
  expect(construct).toHaveBeenCalledTimes(1)
  expect(lookup).toHaveBeenCalledTimes(1)
})

it('rejects malformed interpolation/tensors and invalid preparation without mutating caller state', () => {
  const project = fixture(), before = structuredClone(project)
  const tensors = project.sample.elementProfiles.map(() => new Float64Array(18))
  const tables = [table('Fe', 'ff')]
  const lookup = () => ({ values: new Float64Array([1, 2]), cursor: 0 })
  const construct = () => new Float64Array(18)
  expect(() => refreshElementOptics(project, tables, 0, lookup, construct)).toThrow('positive')
  expect(() => refreshElementOptics(project, tables, 150, lookup, construct, new Map(), [])).toThrow('count')
  expect(() => refreshElementOptics(project, tables, 150, () => ({ values: new Float64Array([NaN, 2]), cursor: 0 }), construct)).toThrow('Invalid element factors')
  expect(() => refreshElementOptics(project, tables, 150, lookup, () => new Float64Array(17), new Map(), tensors)).toThrow('Invalid element scattering')
  expect(project).toEqual(before)
  expect(tensors.every(tensor => tensor.every(value => value === 0))).toBe(true)
})


it('rejects full scattering overrides explicitly until legacy cross-element assignment is resolved', () => {
  const project = fixture(), before = structuredClone(project)
  const tables = [table('Fe', 'ff'), table('Fe', 'f')]
  const lookup = vi.fn(() => ({ values: new Float64Array([26, 2]), cursor: 0 }))
  const construct = vi.fn(() => new Float64Array(18))
  expect(() => refreshElementOptics(project, tables, 150, lookup, construct)).toThrow('element-assignment decision')
  expect(lookup).not.toHaveBeenCalled()
  expect(construct).not.toHaveBeenCalled()
  expect(project).toEqual(before)
  // Missing/out-of-range primary data still retains stored state without reading .F.
  expect(refreshElementOptics(project, tables, 250, lookup, construct).updated).toEqual([false, false, false, false])
})
