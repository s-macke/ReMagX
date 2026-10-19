import { expect, it, vi } from 'vitest'
import { createElementDensitySampler } from './elementDensity'
import type { Project } from './project'

type Profile = Project['sample']['elementProfiles'][number]
const profile = (): Profile => ({ element: 'Fe', f1: 1, f2: 0, f1Mag: 0, f2Mag: 0,
  slabs: [{ thickness: 100, roughness: 0, density: 2 }, { thickness: 10, roughness: 3, density: 6 },
    { thickness: 100, roughness: 99, density: 4 }] })

it('prepares legacy boundaries and roughness, calls upper before lower and normalizes overlap', () => {
  const element = profile()
  const lookup = vi.fn().mockReturnValueOnce(-.5).mockReturnValueOnce(.5)
    .mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(.5).mockReturnValueOnce(-.5)
  const sample = createElementDensitySampler([element], lookup)
  const density = sample(element, 5)
  const scale = 1 / Math.sqrt(2)
  expect(lookup.mock.calls.map(call => call[0])).toEqual([
    5 / 1e-6 * scale, (5 + 1e10) / 1e-5 * scale,
    (5 - 10) / 3 * scale, 5 / 1e-6 * scale,
    (5 - 1e10) / 1e-5 * scale, (5 - 10) / 3 * scale,
  ])
  const weights = [.25 * 1.5 * 1.5, .25, .25 * .5 * .5]
  expect(density).toBe((weights[0] * 2 + weights[1] * 6 + weights[2] * 4) / weights.reduce((a, b) => a + b))
})

it('copies prepared slab values and preserves the first-slab rule for a one-slab profile', () => {
  const element = profile(); element.slabs.length = 1
  const lookup = vi.fn((_position: number) => 0)
  const sample = createElementDensitySampler([element], lookup)
  element.slabs[0].density = 99
  expect(sample(element, 0)).toBe(2)
  expect(lookup.mock.calls.map(call => call[0])).toEqual([0, 1e10 / 1e-5 * (1 / Math.sqrt(2))])
  expect(() => sample(profile(), 0)).toThrow('not prepared')
})

it('reports undefined normalization and invalid inputs instead of publishing nonfinite densities', () => {
  const element = profile()
  expect(() => createElementDensitySampler([element], () => NaN)(element, 0)).toThrow('error-function')
  expect(() => createElementDensitySampler([element], () => 1)(element, 0)).toThrow('normalization')
  element.slabs = []
  expect(() => createElementDensitySampler([element], () => 0)(element, 0)).toThrow('normalization')
  expect(() => createElementDensitySampler([element], () => 0)(element, Infinity)).toThrow('finite')
  element.slabs = [{ thickness: 0, roughness: -1, density: 1 }]
  expect(() => createElementDensitySampler([element], () => 0)).toThrow('slab')
})
