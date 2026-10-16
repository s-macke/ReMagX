import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { prepareVisnovskyQzRequest } from './visnovskyRequest'

it('expands compound layers and constructs tensors once per layer for both beams', () => {
  const project = createDefaultProject()
  project.calculation.algorithm = 'matrix'
  project.calculation.epsilon = 0
  project.calculation.tensorContribution = 'tetragonal'
  project.calculation.magnetization.mode = 'none'
  project.sample.multilayer = { enabled: true, pattern: '2*(1)' }
  project.experiment.qzScan.points = 2
  const before = structuredClone(project)
  const values = new Float64Array(18).fill(.2)
  const construct = vi.fn(() => ({ values, anisotropic: true }))
  const request = prepareVisnovskyQzRequest(project, 'dichroic', construct)
  expect(request.layers).toHaveLength(4)
  expect(construct).toHaveBeenCalledTimes(4)
  expect(construct.mock.calls[0]).toEqual([{ layer: [project.sample.layers[0].thickness, project.sample.layers[0].roughness,
    project.sample.layers[0].delta, project.sample.layers[0].beta, project.sample.layers[0].deltaMag,
    project.sample.layers[0].betaMag, project.sample.layers[0].magnetization.gamma, project.sample.layers[0].magnetization.phi], tensor: 1, magnetic: 0 }])
  expect(request.layers[0].values.slice(0, 4)).toEqual([project.sample.layers[0].thickness,
    project.sample.layers[0].roughness, 1 - project.sample.layers[0].delta, project.sample.layers[0].beta])
  expect(request.epsilon).toBe(0)
  expect(request.mode).toBe(1)
  expect(request.layers.every(layer => layer.anisotropic === 1 && layer.values.length === 22)).toBe(true)
  values[0] = 50
  expect(request.layers[0].values[4]).toBe(.2)
  expect(project).toEqual(before)
})

it('rejects incomplete preparation and malformed engine tensors', () => {
  const project = createDefaultProject()
  project.calculation.algorithm = 'matrix'
  const construct = () => ({ values: new Float64Array(18), anisotropic: false })
  project.calculation.magnetization.mode = 'profile'
  expect(() => prepareVisnovskyQzRequest(project, 'monochromatic', construct)).toThrow('profile')
  project.calculation.magnetization.mode = 'none'
  project.calculation.epsilon = NaN
  expect(() => prepareVisnovskyQzRequest(project, 'monochromatic', construct)).toThrow('epsilon')
  project.calculation.epsilon = -1
  expect(prepareVisnovskyQzRequest(project, 'monochromatic', construct).epsilon).toBe(-1)
  expect(() => prepareVisnovskyQzRequest(project, 'monochromatic', () => ({ values: new Float64Array(17), anisotropic: false }))).toThrow('invalid dielectric')
  project.calculation.roughnessModel = 'segmentation'
  expect(() => prepareVisnovskyQzRequest(project, 'monochromatic', construct)).toThrow('segmentation')
})
