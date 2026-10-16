import { expect, it } from 'vitest'
import { profilePlot } from './profileView'

it('illustrates both complex profiles with steps and zero boundary strokes without changing samples', () => {
  const profile = { z: [0, 2, 4], delta: [1, 2, 3], beta: [4, 5, 6], deltaMag: [-1, -2, -3], betaMag: [-4, -5, -6],
    segments: [{ start: 0, end: 2, delta: 1.5, beta: 4.5, deltaMag: -1.5, betaMag: -4.5 }, { start: 2, end: 4, delta: 2.5, beta: 5.5, deltaMag: -2.5, betaMag: -5.5 }] }
  const before = structuredClone(profile)
  const optical = profilePlot(profile, false, true)
  expect(optical.x).toEqual([0, 0, 0, 2, 2, 2, 2, 4])
  expect(optical.series[0].y).toEqual([1.5, 0, 1.5, 1.5, 2.5, 0, 2.5, 2.5])
  expect(optical.series[1].y).toEqual([4.5, 4.5, 4.5, 4.5, 5.5, 5.5, 5.5, 5.5])
  expect(profilePlot(profile, true, true).series[0].y[0]).toBe(-1.5)
  expect(profilePlot(profile, true, false).series[0].y).toEqual(profile.deltaMag)
  expect(profilePlot(profile, false, false).x).toEqual(profile.z)
  expect(profile).toEqual(before)
})
