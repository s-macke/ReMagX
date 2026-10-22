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

it('batches current slab densities while preserving pointwise optical conversion and isolated inputs', () => {
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
      const values = request.positions.map(depth => request.slabs[0][2] + depth)
      calls.push(request.positions.slice())
      request.slabs[0][2] = 999; request.errorSamples[0] = 999
      return new Float64Array(values)
    }, optics,
  })
  expect(result).toEqual(prepareElementLayers(project, (profile, depth) => profile.slabs[0].density + depth, optics))
  expect(calls).toEqual([Array.from({ length: 8 }, (_, index) => -30 + index * 10), Array.from({ length: 8 }, (_, index) => -30 + index * 10)])
  expect(project).toEqual(before)
  expect(samples).toEqual(Array(1001).fill(0))
})

it('preserves supplied scattering tensors through matrix conversion and copies returned tensors', () => {
  const project = fixture(); project.calculation.algorithm = 'matrix'
  const tensors = [new Float64Array(18).fill(2), new Float64Array(18).fill(3)]
  const returned = new Float64Array(18).fill(4)
  const result = prepareSampledElementLayers(project, Array(1001).fill(0), {
    density: request => new Float64Array(request.positions.length).fill(1),
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


it('keeps repeated-addition positions across batch boundaries and owns reused native outputs', () => {
  const project = fixture()
  project.calculation.segmentation.minThickness = .1
  project.sample.elementProfiles.forEach(profile => profile.slabs.forEach(slab => {
    slab.thickness = 0; slab.roughness = 0
  }))
  const depths: number[] = []
  for (let depth = -30; depth <= 30; depth += .1) depths.push(depth)
  // Multiplication would change the original grid even at a batch boundary.
  expect(depths[256]).not.toBe(-30 + 256 * .1)
  const shared = new Float64Array(256), sizes: number[] = [], sampled: number[][] = []
  let converted = 0
  const result = prepareSampledElementLayers(project, Array(1001).fill(0), {
    density: request => {
      const density = request.slabs[0][2]
      sampled.push(request.positions.slice()); sizes.push(request.positions.length)
      request.positions.forEach((depth, index) => { shared[index] = depth + density })
      const count = request.positions.length
      request.positions.fill(999); request.slabs[0][2] = 999; request.errorSamples.fill(999)
      return shared.subarray(0, count)
    },
    optics: request => {
      expect(request.elements.map(element => element[0])).toEqual([depths[converted] + 2, depths[converted] + 3])
      converted++
      return { opticalConstants: new Float64Array([converted, 0, 0, 0]), dielectricTensor: null }
    },
  })
  expect(result.samples).toBe(depths.length)
  expect(result.positions).toEqual(depths)
  expect(sizes).toEqual([256, 256, 256, 256, depths.length - 512, depths.length - 512])
  expect(sampled.filter((_, index) => index % 2 === 0).flat()).toEqual(depths)
  expect(sampled.filter((_, index) => index % 2 === 1).flat()).toEqual(depths)
})

it('rejects a nonfinite later density in a batch before optical conversion', () => {
  const project = fixture()
  let converted = 0
  expect(() => prepareSampledElementLayers(project, Array(1001).fill(0), {
    density: request => { const values = new Float64Array(request.positions.length); values[values.length - 1] = NaN; return values },
    optics: () => { ++converted; return { opticalConstants: new Float64Array(4), dielectricTensor: null } },
  })).toThrow('density result')
  expect(converted).toBe(0)
})
