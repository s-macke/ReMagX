import type { PreparedCompoundLayer } from './compoundLayers'
import type { Project } from './project'

export interface SegmentationTensor { values: Float64Array; anisotropic: boolean }
export interface SegmentationEngine {
  sample(request: { layers: PreparedCompoundLayer[]; model: 1 | 2; position: number;
    errorSamples: number[]; tensors: number[][] | null; tensorState: Float64Array | null }): {
    opticalConstants: Float64Array; dielectricTensor: Float64Array | null
  }
  subdivide(request: { minimumDepth: number; maximumDepth: number; minimumStep: number;
    maximumStep: number; gradientScale: number; valueCount: 4 | 22; capacity: number;
    sample(position: number, slot: number): number[] }): {
    positions: Float64Array; thicknesses: Float64Array; values: Float64Array
  }
}

// LayerSegmentation2 preparation after table refresh, Lua and multilayer expansion.
// Explicit lookup samples are mandatory; this stage does not select their policy.
// Magnetic profile application follows this stage and is not performed here.
export function prepareSegmentedLayers(input: readonly PreparedCompoundLayer[],
  settings: Project['calculation']['segmentation'], errorSamples: readonly number[], engine: SegmentationEngine,
  inputTensors?: readonly SegmentationTensor[], maximumLayers = 1000000) {
  const finite = (values: ArrayLike<number>, count: number) => values.length === count && Array.from(values).every(Number.isFinite)
  if (input.length < 2 || !Array.from(input).every(row => row && finite(row, 8) && row[0] >= 0 && row[1] >= 0) ||
      !finite(errorSamples, 1001) || !Number.isFinite(settings.minThickness) || settings.minThickness <= 0 ||
      !Number.isFinite(settings.maxThickness) || settings.maxThickness < settings.minThickness ||
      !Number.isFinite(settings.gradientScale) || !['global', 'local'].includes(settings.scope) ||
      !Number.isSafeInteger(maximumLayers) || maximumLayers < 1 || maximumLayers > 1000000) {
    throw new Error('Invalid compound segmentation input.')
  }
  if (inputTensors && (inputTensors.length !== input.length || !Array.from(inputTensors).every(tensor =>
    tensor && finite(tensor.values, 18) && typeof tensor.anisotropic === 'boolean'))) {
    throw new Error('Invalid segmentation tensor mapping.')
  }
  const layers = input.map(row => row.slice() as PreparedCompoundLayer)
  const tables = Array.from(errorSamples)
  const tensors = inputTensors ? inputTensors.map(tensor => Array.from(tensor.values)) : null
  // The original classification scan excludes ambient, even when it is anisotropic.
  const anisotropic = inputTensors?.slice(0, -1).some(tensor => tensor.anisotropic) ?? false
  let thickness = 0
  for (let index = 1; index < layers.length - 1; ++index) thickness += layers[index][0]
  const minimumDepth = layers[0][1] > 10 ? -layers[0][1] * 3 : -30
  const terminalRoughness = layers.at(-2)![1]
  const maximumDepth = terminalRoughness > 10 ? thickness + terminalRoughness * 3 : thickness + 30
  if (!Number.isFinite(minimumDepth) || !Number.isFinite(maximumDepth)) throw new Error('Segmentation depth range overflow.')
  const states: (Float64Array | null)[] = [null, null, null, null]
  const width = tensors ? 22 : 4
  const result = engine.subdivide({ minimumDepth, maximumDepth, minimumStep: settings.minThickness,
    maximumStep: settings.maxThickness, gradientScale: settings.gradientScale, valueCount: width, capacity: maximumLayers,
    sample(position, slot) {
      if (!Number.isFinite(position) || !Number.isInteger(slot) || slot < 0 || slot > 3) throw new Error('Invalid segmentation sampling slot or position.')
      const sampled = engine.sample({ layers, model: settings.scope === 'global' ? 1 : 2, position,
        errorSamples: tables, tensors, tensorState: states[slot] })
      if (!finite(sampled.opticalConstants, 4) || (tensors && (!sampled.dielectricTensor || !finite(sampled.dielectricTensor, 18)))) {
        throw new Error('Invalid segmented optical sample.')
      }
      states[slot] = tensors ? sampled.dielectricTensor!.slice() : null
      return [...sampled.opticalConstants, ...(states[slot] ?? [])]
    } })
  const count = result.positions.length
  if (count < 1 || count > maximumLayers || !finite(result.positions, count) || !finite(result.thicknesses, count) ||
      result.thicknesses.some(value => value < 0) || !finite(result.values, count * width)) {
    throw new Error('Invalid adaptive segmentation output.')
  }
  const generated: PreparedCompoundLayer[] = Array.from(result.positions, (_, index) => [result.thicknesses[index], 0,
    ...Array.from(result.values.slice(index * width, index * width + 4)), 90, 90] as PreparedCompoundLayer)
  const dielectricTensors = Array.from(result.positions, (_, index) => tensors ? {
    values: result.values.slice(index * width + 4, (index + 1) * width),
    anisotropic: index > 0 && index < count - 1 && anisotropic,
  } : null)
  return { layers: generated, positions: Array.from(result.positions), dielectricTensors }
}
