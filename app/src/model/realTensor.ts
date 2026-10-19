import { visitCompoundSpectrum } from './compoundSpectrum'
import type { RealBeforeCalculation } from './realCalculation'
import type { TensorQuery } from '../compute/ComputeService'
import type { OpticalTable } from '../import/tables'
import type { Project, Layer } from './project'
import type { TensorPreview } from './tensorView'
import type { DielectricTensorCalculator } from './visnovskyRequest'
import { refreshCompoundOpticsState, type RealTableLookup } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'

// Scalar and imported compound tensors; no segmentation or reflection solver is
// involved in the legacy tensor viewer. Spectrum hooks read stored tensor state.
export function realTensor(project: Project, query: TensorQuery, lookup: RealTableLookup,
  construct: DielectricTensorCalculator, beforeCalculation?: RealBeforeCalculation): TensorPreview {
  const selected = project.sample.layers[query.layerIndex]
  if (project.sample.mode !== 'compound' || !selected) throw new Error('Select a compound layer to show its dielectric tensor.')
  if (!beforeCalculation && query.spectrum && project.scripts.enabled && project.scripts.beforeCalculation.trim()) {
    throw new Error('BeforeCalculation Lua execution is not implemented in real tensor spectra yet.')
  }
  const table = (kind: OpticalTable['kind']) => query.tables.find(table => selected.opticalTable !== '' &&
    table.name === selected.opticalTable && table.kind === kind && table.energy.length)
  const grid = table('e') ?? table('db')
  if (query.spectrum && !grid) throw new Error(`Load ${selected.opticalTable || 'the selected material'}.e or .db to show its tensor spectrum.`)
  const energy = query.spectrum ? grid!.energy.slice() : [project.experiment.energy]
  if (!energy.length || !energy.every(value => Number.isFinite(value) && value > 0)) throw new Error('Tensor energies must be positive and finite.')
  if (query.spectrum && project.scripts.enabled && project.scripts.beforeCalculation.trim()) {
    const tensors: TensorPreview['tensors'] = []
    visitCompoundSpectrum(project, query.tables, energy, lookup, (_current, state) => {
      const values = state.dielectricState?.[query.layerIndex]?.values
      if (!values || values.length !== 18 || !values.every(Number.isFinite)) throw new Error('Invalid scripted dielectric tensor.')
      tensors.push(Array.from({ length: 9 }, (_, index) => ({ re: values[2 * index], im: values[2 * index + 1] })))
    }, beforeCalculation)
    return { engine: 'real', energy, tensors, source: 'script' }
  }
  const build = (layer: Layer) => {
    const result = construct({ layer: [layer.thickness, layer.roughness, layer.delta, layer.beta,
      layer.deltaMag, layer.betaMag, layer.magnetization.gamma, layer.magnetization.phi],
      tensor: project.calculation.tensorContribution === 'tetragonal' ? 1 : 0,
      magnetic: project.calculation.magnetization.mode === 'none' ? 0 : 1 })
    if (result.values.length !== 18 || !result.values.every(Number.isFinite)) throw new Error('Invalid native dielectric tensor.')
    return result.values.slice()
  }
  let values: Float64Array | undefined
  let source: TensorPreview['source'] = 'scalar'
  let layers = project.sample.layers
  let overrides: (Float64Array | null)[] = layers.map(() => null)
  const cursors = new Map<OpticalTable, number>()
  const refresh = (value: number) => {
    const lookupEnergy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / value)
    // Filldb continues past missing tables. Refresh the available subset in the
    // original layer order, retaining shared cursors even for unselected layers.
    const indices = layers.flatMap((layer, index) => query.tables.some(candidate => layer.opticalTable !== '' &&
      candidate.name === layer.opticalTable && candidate.kind === 'db' && candidate.energy.length) ? [index] : [])
    const local = { ...project, sample: { ...project.sample, layers: indices.map(index => layers[index]) } }
    const refreshed = refreshCompoundOpticsState(local, query.tables, lookupEnergy, lookup, cursors,
      indices.map(index => overrides[index]))
    const nextLayers = layers.slice(), nextOverrides = overrides.slice()
    indices.forEach((index, position) => { nextLayers[index] = refreshed.layers[position]; nextOverrides[index] = refreshed.dielectricTensors[position] })
    layers = nextLayers; overrides = nextOverrides
    const primary = table('db')
    if (primary && lookupEnergy >= primary.energy[0] && lookupEnergy <= primary.energy.at(-1)!) {
      const override = overrides[query.layerIndex]
      values = override ? override.slice() : build(layers[query.layerIndex])
      source = override ? 'table' : 'scalar'
    }
  }
  // GetState refreshes automatic constants before the spectrum's energy loop.
  if (project.calculation.automaticOpticalConstants) refresh(project.experiment.energy)
  let usedTable = false
  const tensors = energy.map(value => {
    if (query.spectrum) refresh(value)
    usedTable ||= source === 'table'
    const tensor = values ??= build(selected)
    return Array.from({ length: 9 }, (_, index) => ({ re: tensor[2 * index], im: tensor[2 * index + 1] }))
  })
  return { engine: 'real', energy, tensors, source: usedTable ? 'table' : 'scalar' }
}
