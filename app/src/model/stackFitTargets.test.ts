import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { createFitParameter } from './fitTargets'
import { insertLayerAbove, removeLayer } from './layers'
import { insertSlabAbove, removeSlab } from './elements'

it('preserves layer targets and bounds across insertion, removes deleted targets and leaves other targets alone', () => {
  const project = createDefaultProject()
  project.fit.parameters = [
    createFitParameter(project, 'delta', 0, null),
    { ...createFitParameter(project, 'thickness', 2, null), lowerBound: 10, upperBound: 95, step: 0.3 },
    createFitParameter(project, 'beta', 13, null),
    createFitParameter(project, 'profileCenter', 2, null),
    createFitParameter(project, 'elementDensity', 2, 0),
    createFitParameter(project, 'scriptParameter', 2, null),
  ]
  const added = insertLayerAbove(project, 1).project
  expect(added.fit.parameters.map(p => p.index)).toEqual([0, 3, 14, 2, 2, 2])
  expect(added.fit.parameters[1]).toEqual({ ...project.fit.parameters[1], index: 3 })
  expect(removeLayer(added, 2).fit.parameters).toEqual(project.fit.parameters)
  const removed = removeLayer(project, 2)
  expect(removed.fit.parameters).toEqual([project.fit.parameters[0], { ...project.fit.parameters[2], index: 12 }, ...project.fit.parameters.slice(3)])
  expect(project.fit.parameters[1].index).toBe(2)
  expect(removeLayer(project, -1)).toBe(project)
  expect(removeLayer(project, 100)).toBe(project)
  expect(insertLayerAbove(project, 100).project).toBe(project)
})

it('reindexes only the selected element slab stack and preserves scattering-factor and layer targets', () => {
  const project = createDefaultProject()
  project.sample.elementProfiles = ['Co', 'Ni'].map(element => ({ element, f1: 1, f2: 2, f1Mag: 0, f2Mag: 0,
    slabs: Array.from({ length: 4 }, () => ({ thickness: 10, density: 1, roughness: 2 })) }))
  project.fit.parameters = [
    createFitParameter(project, 'elementDensity', 1, 0),
    createFitParameter(project, 'elementThickness', 2, 0),
    createFitParameter(project, 'elementRoughness', 3, 0),
    createFitParameter(project, 'elementDensity', 2, 1),
    createFitParameter(project, 'elementF1', null, 0),
    createFitParameter(project, 'thickness', 2, null),
  ]
  const added = insertSlabAbove(project, 0, 1).project
  expect(added.fit.parameters.map(p => p.index)).toEqual([1, 3, 4, 2, null, 2])
  expect(removeSlab(added, 0, 2).fit.parameters).toEqual(project.fit.parameters)
  expect(removeSlab(project, 0, 2).fit.parameters).toEqual([
    project.fit.parameters[0], { ...project.fit.parameters[2], index: 2 }, ...project.fit.parameters.slice(3),
  ])
  expect(project.fit.parameters[1].index).toBe(2)
  expect(removeSlab(project, 0, 1.5)).toBe(project)
  expect(insertSlabAbove(project, 0, -1).project).toBe(project)
})
