import { expect, it } from 'vitest'
import { createDefaultProject, createDepthProfileFunction } from './defaults'
import { buildProfileSpline, removeMagneticProfile } from './magneticProfiles'
import { toggleCellFit } from './cellFit'

it('deletes profile targets and remaps surviving fits and couplings without mutating the project', () => {
  let project = createDefaultProject()
  project.sample.depthProfileFunctions = Array.from({ length: 3 }, createDepthProfileFunction)
  project.sample.depthProfileFunctions[0].amplitudeCoupledTo = 1
  project.sample.depthProfileFunctions[0].widthCoupledTo = 2
  project = toggleCellFit(project, { target: 'profileCenter', index: 1, elementIndex: null })
  project = toggleCellFit(project, { target: 'profileWidth', index: 2, elementIndex: null })
  project = toggleCellFit(project, { target: 'thickness', index: 2, elementIndex: null })
  const result = removeMagneticProfile(project, 1)
  expect(result.sample.depthProfileFunctions).toHaveLength(2)
  expect(result.sample.depthProfileFunctions[0].amplitudeCoupledTo).toBeNull()
  expect(result.sample.depthProfileFunctions[0].widthCoupledTo).toBe(1)
  expect(result.fit.parameters.map(p => [p.target, p.index])).toEqual([['profileWidth', 1], ['thickness', 2]])
  expect(project.sample.depthProfileFunctions).toHaveLength(3)
  expect(project.fit.parameters).toHaveLength(3)
  expect(removeMagneticProfile(project, -1)).toBe(project)
})

it('builds nine normalized Gaussian samples and preserves profile settings', () => {
  const profile = { ...createDepthProfileFunction(), center: 10, width: 2, deltaAmplitude: 3, betaAmplitude: 7 }
  const built = buildProfileSpline(profile)
  expect(built.spline.enabled).toBe(true)
  expect(built.spline.points.map(point => point.z)).toEqual([-2, 1, 4, 7, 10, 13, 16, 19, 22])
  expect(built.spline.points[4].value).toBe(1)
  expect(built.spline.points[3].value).toBeCloseTo(Math.exp(-1.125), 14)
  expect(built.spline.points[0].value).toBeCloseTo(Math.exp(-18), 14)
  expect(built.betaAmplitude).toBe(7)
  expect(profile.spline.points).toEqual([])
  expect(buildProfileSpline({ ...profile, deltaAmplitude: 0 }).spline.points.every(point => point.value === 0)).toBe(true)
  expect(buildProfileSpline({ ...profile, width: 0 }).spline.points.every(point => point.value === 0 && point.z === 10)).toBe(true)
  expect(() => buildProfileSpline({ ...profile, width: Number.MAX_VALUE })).toThrow('too large')
})
