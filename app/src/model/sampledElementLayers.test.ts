import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { prepareSampledElementLayers } from './sampledElementLayers'
import { prepareElementLayers } from './elementLayers'

function fixture() {
  const project = createDefaultProject()
  project.sample.mode = 'element'
  project.calculation.segmentation.minThickness = 10
  project.calculation.segmentation.tolerance = 0
  project.sample.elementProfiles = [2, 3].map(density => ({ element: 'Fe', f1: density, f2: 1,
    f1Mag: 0, f2Mag: 0, slabs: [{ thickness: 0, roughness: 0, density },
      { thickness: 10, roughness: 2, density: density * 2 }, { thickness: 0, roughness: 0, density: 0 }] }))
  return project
}

it('composes current slab density and optical conversion in profile/depth order with isolated inputs', () => {
  const project = fixture(), samples = Array(1001).fill(0)
  const before = structuredClone(project)
  const calls: number[][] = []
  const optics = ({ elements }: { elements: number[][] }) => ({
    opticalConstants: new Float64Array([elements.reduce((sum, row) => sum + row[0] * row[1], 0), 0, 0, 0]),
    dielectricTensor: null,
  })
  const result = prepareSampledElementLayers(project, samples, {
    density: request => {
      expect(request.errorSamples).toEqual(samples)
      const density = request.slabs[0][2] + request.positions[0]
      calls.push([request.positions[0], request.slabs[0][2]])
      request.slabs[0][2] = 999; request.errorSamples[0] = 999
      return new Float64Array([density])
    }, optics,
  })
  expect(result).toEqual(prepareElementLayers(project, (profile, depth) => profile.slabs[0].density + depth, optics))
  expect(calls).toEqual(Array.from({ length: 8 }, (_, index) => [[-30 + index * 10, 2], [-30 + index * 10, 3]]).flat())
  expect(project).toEqual(before)
  expect(samples).toEqual(Array(1001).fill(0))
})

it('preserves supplied scattering tensors through matrix conversion and copies returned tensors', () => {
  const project = fixture(); project.calculation.algorithm = 'matrix'
  const tensors = [new Float64Array(18).fill(2), new Float64Array(18).fill(3)]
  const returned = new Float64Array(18).fill(4)
  const result = prepareSampledElementLayers(project, Array(1001).fill(0), {
    density: () => new Float64Array([1]),
    optics: request => {
      expect(request.scatteringTensors).toEqual(tensors.map(value => Array.from(value)))
      request.scatteringTensors![0][0] = 999
      return { opticalConstants: new Float64Array([1, 2, 3, 4]), dielectricTensor: returned }
    },
  }, tensors)
  returned.fill(9)
  expect(result.dielectricTensors[0]).toEqual(new Float64Array(18).fill(4))
  expect(tensors[0][0]).toBe(2)
})

it('rejects malformed density results, lookup samples and sampling limits without converting partial results', () => {
  const project = fixture()
  let conversions = 0
  const engine = { density: () => new Float64Array(0), optics: () => {
    ++conversions; return { opticalConstants: new Float64Array(4), dielectricTensor: null }
  } }
  expect(() => prepareSampledElementLayers(project, [], engine)).toThrow('1001')
  expect(() => prepareSampledElementLayers(project, Array(1001).fill(NaN), engine)).toThrow('finite')
  expect(() => prepareSampledElementLayers(project, Array(1001).fill(0), engine)).toThrow('density result')
  engine.density = () => new Float64Array([NaN])
  expect(() => prepareSampledElementLayers(project, Array(1001).fill(0), engine)).toThrow('density result')
  expect(conversions).toBe(0)
  engine.density = () => new Float64Array([1])
  expect(() => prepareSampledElementLayers(project, Array(1001).fill(0), engine, [], 1)).toThrow('limit')
})
