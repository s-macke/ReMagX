import { expect, it } from 'vitest'
import { createDefaultProject, createDepthProfileFunction } from './defaults'
import { removeMagneticProfile } from './magneticProfiles'
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
