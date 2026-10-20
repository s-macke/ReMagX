import { calculateRealCurve, type RealCalculationEngine } from '../src/model/realCalculation'
import { prepareParrattQzRequest } from '../src/model/parrattRequest'
import { prepareZakQzRequest } from '../src/model/zakRequest'
import { prepareVisnovskyQzRequest } from '../src/model/visnovskyRequest'
import { storedOpticalState } from '../src/model/storedOpticalState'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { createDefaultProject } from '../src/model/defaults'
import { prepareSampledElementLayers } from '../src/model/sampledElementLayers'
import { prepareElementLayers } from '../src/model/elementLayers'
import { createElementDensitySampler } from '../src/model/elementDensity'

it.skipIf(!process.env.WASM_MODULE)('composes actual WASM element density and optics against independent density preparation', async () => {
  const { default: createCore } = await import(/* @vite-ignore */ pathToFileURL(resolve(process.env.WASM_MODULE!)).href)
  const adapterPath = pathToFileURL(resolve('../engine/wasm/parratt.mjs')).href
  const adapter = await import(/* @vite-ignore */ adapterPath)
  const { calculateElementDensity, calculateElementOptics, calculateScatteringTensor } = adapter
  const core = await createCore()
  // Synthetic lookup exercises interpolation and saturation, not a proposed production generator.
  const samples = Array.from({ length: 1001 }, (_, index) => Math.tanh(-5 + 10 * index / 999))
  const lookup = (position: number) => {
    if (position < -5) return -1
    if (position > 5) return 1
    const coordinate = 0 - (-5 - position) / (-5 - 5) * (0 - 999)
    const left = Math.trunc(coordinate)
    return samples[left] - (left - coordinate) / (left - (left + 1)) * (samples[left] - samples[left + 1])
  }
  let compared = 0
  for (const algorithm of ['parratt', 'zak', 'matrix'] as const) {
    for (const roughness of [0, 2]) {
      const project = createDefaultProject(); project.sample.mode = 'element'
      project.calculation.algorithm = algorithm
      project.calculation.automaticOpticalConstants = false
      project.experiment.qzScan.points = 6
      project.calculation.segmentation.minThickness = 1
      project.calculation.segmentation.tolerance = 1e-9
      project.sample.elementProfiles = [2, 3].map((density, index) => ({ element: 'Fe', f1: 20 + index, f2: 2,
        f1Mag: .2, f2Mag: .1, slabs: [{ thickness: 99, roughness, density },
          { thickness: 10 + index * 5, roughness: roughness + 1, density: density * 2 },
          { thickness: 99, roughness: 99, density: 0 }] }))
      const before = JSON.stringify(project)
      const tensors = project.sample.elementProfiles.map(profile => calculateScatteringTensor(core, {
        factors: [profile.f1, profile.f2, profile.f1Mag, profile.f2Mag], gamma: 32, phi: 17, tensor: 0, magnetic: 1,
      }))
      const optics = (request: unknown) => calculateElementOptics(core, request)
      const expected = prepareElementLayers(project, createElementDensitySampler(project.sample.elementProfiles, lookup), optics, tensors)
      const actual = prepareSampledElementLayers(project, samples, {
        density: request => calculateElementDensity(core, request), optics,
      }, tensors)
      expect(actual.samples).toBe(expected.samples)
      expect(actual.positions).toEqual(expected.positions)
      expect(actual.layers.length).toBeGreaterThan(1)
      const flatten = (result: typeof actual) => [...result.layers.flat(), ...result.dielectricTensors.flatMap(value => value ? Array.from(value) : [])]
      const values = flatten(actual), references = flatten(expected)
      expect(values.length).toBe(references.length)
      values.forEach((value, index) => expect(Math.abs(value - references[index])).toBeLessThanOrEqual(1e-15 + 1e-10 * Math.abs(references[index])))
      compared += values.length
      const engine: RealCalculationEngine = {
        calculate: request => adapter.calculateParrattQz(core, request),
        zakQz: request => adapter.calculateZakQz(core, request),
        matrixQz: request => adapter.calculateVisnovskyQz(core, request),
        dielectricTensor: request => adapter.calculateDielectricTensor(core, request),
        energyScan: request => adapter.calculateParrattEnergyScan(core, request),
        zakEnergy: request => adapter.calculateZakEnergyScan(core, request),
        matrixEnergy: request => adapter.calculateVisnovskyEnergyScan(core, request),
        lookup: () => { throw new Error('Unexpected table lookup') },
        elementPreparation: { errorSamples: samples, density: request => calculateElementDensity(core, request), optics },
      }
      const state = { ...storedOpticalState(project), scatteringTensors: tensors }
      for (const mode of ['monochromatic', 'dichroic'] as const) {
        const curve = calculateRealCurve(project, [], engine, 'qz', mode, state)
        const raw = algorithm === 'matrix' ? engine.matrixQz(prepareVisnovskyQzRequest(project, mode, engine.dielectricTensor, undefined, undefined,
          { layers: expected.layers, dielectricTensors: expected.dielectricTensors.map(values => values ? { values, anisotropic: true } : null) }))
          : algorithm === 'zak' ? engine.zakQz(prepareZakQzRequest(project, mode, undefined, expected.layers))
            : engine.calculate(prepareParrattQzRequest(project, mode, undefined, expected.layers))
        curve.reflectivityPlus.forEach((value, index) => expect(Math.abs(value - raw[index * 2])).toBeLessThanOrEqual(1e-15 + 1e-10 * Math.abs(raw[index * 2])))
        if (mode === 'dichroic') curve.reflectivityMinus.forEach((value, index) => expect(Math.abs(value - raw[index * 2 + 1])).toBeLessThanOrEqual(1e-15 + 1e-10 * Math.abs(raw[index * 2 + 1])))
      }
      expect(JSON.stringify(project)).toBe(before)
    }
  }
  expect(compared).toBeGreaterThan(100)
}, 30000)
