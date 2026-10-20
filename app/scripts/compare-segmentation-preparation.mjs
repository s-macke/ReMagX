// Private comparison inputs arrive through stdin and are never logged or saved.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applySegmentedMagneticProfiles } from '../src/model/segmentedMagneticProfiles.ts'
import { calculateLayerDensity, applyMagneticProfiles } from '../../engine/wasm/parratt.mjs'
import { prepareSegmentedLayers } from '../src/model/segmentedLayers.ts'
import { calculateAdaptiveSegments, calculateSegmentedOptics, createSegmentedOpticalSampler } from '../../engine/wasm/segmentation.mjs'

const payload = JSON.parse(readFileSync(0, 'utf8'))
const { default: createCore } = await import(pathToFileURL(resolve(process.argv[2])).href)
const core = await createCore()
let values = 0, layers = 0
for (const [index, item] of payload.cases.entries()) {
  const before = JSON.stringify(item)
  const tensors = item.matrix ? item.tensors.map((row, layer) => ({ values: new Float64Array(row), anisotropic: item.anisotropic[layer] })) : undefined
  const generated = prepareSegmentedLayers(item.layers, item.settings, payload.samples, {
    sample: request => calculateSegmentedOptics(core, request),
    prepareSampler: request => createSegmentedOpticalSampler(core, request),
    subdivide: request => calculateAdaptiveSegments(core, request),
  }, tensors, 10000)
  if (item.profiles.length) {
    const boundaries = item.depths
    generated.layers = applySegmentedMagneticProfiles(generated.layers, generated.positions, boundaries,
      item.layers.map(layer => layer[1]), item.profiles, item.additive, payload.samples, {
        density: request => calculateLayerDensity(core, request),
        apply: request => applyMagneticProfiles(core, request),
      })
  }
  if (before !== JSON.stringify(item)) throw new Error(`Segmentation case ${index}: input changed`)
  const actual = generated.layers.flatMap((layer, row) => [generated.positions[row], ...layer,
    ...(item.matrix ? [Number(generated.dielectricTensors[row].anisotropic), ...generated.dielectricTensors[row].values] : [])])
  if (actual.length !== item.expected.length || generated.layers.length !== item.count) throw new Error(`Segmentation case ${index}: size mismatch`)
  actual.forEach((value, component) => {
    const target = item.expected[component]
    if (!Number.isFinite(value) || !Number.isFinite(target) || Math.abs(value - target) > 1e-15 + 1e-10 * Math.abs(target)) {
      throw new Error(`Segmentation case ${index}: comparison failed at component ${component}; values withheld`)
    }
  })
  values += actual.length; layers += generated.layers.length
}
console.log(JSON.stringify({ cases: payload.cases.length, layers, values }))
