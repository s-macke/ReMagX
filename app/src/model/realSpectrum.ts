import { refreshElementOptics } from './refreshElementOptics'
import type { ScatteringTensorCalculator } from './scatteringTensors'
import { HC_EV_ANGSTROM } from './units'
import type { ElementSpectrumQuery, LayerSpectrumQuery, LayerSpectrum } from '../compute/ComputeService'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import { realDatabaseValues } from './realDatabaseValues'
import { applyDatabaseValues } from './databaseValues'
import type { RealTableLookup } from './refreshOpticalConstants'

function grid(project: Project, tables: OpticalTable[], name: string, kind: OpticalTable['kind'], skipZero: boolean) {
  if (project.scripts.enabled && project.scripts.beforeCalculation.trim()) {
    throw new Error('BeforeCalculation Lua execution is not implemented in real spectra yet.')
  }
  const table = tables.find(table => name !== '' && table.name === name && table.kind === kind)
  if (!table?.energy.length) throw new Error(`Load ${name || 'the selected material'}.${kind} to show this spectrum.`)
  const energy = table.energy.filter(value => !skipZero || value !== 0)
  if (!energy.length || !energy.every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('A real spectrum needs positive finite energies.')
  }
  return energy
}

// OnZeigeDeltaBetaSpektrum, OnZeigeDeltaMBetaMSpektrum and
// ShowScatteringFactorsClick ignore Filldb's range flag and keep partial updates.
function evaluate(project: Project, tables: OpticalTable[], energy: number[], lookup: RealTableLookup,
  read: (current: Project, energy: number) => [number, number], construct?: ScatteringTensorCalculator): LayerSpectrum {
  const cursors = new Map<OpticalTable, number>()
  let scatteringTensors: Float64Array[] | undefined
  let current = project
  const first: number[] = [], second: number[] = []
  for (const value of energy) {
    current = { ...current, experiment: { ...current.experiment, energy: value } }
    if (current.sample.mode === 'element') {
      if (!construct) throw new Error('Native element tensor construction is unavailable.')
      const refreshed = refreshElementOptics(current, tables, HC_EV_ANGSTROM / (HC_EV_ANGSTROM / value),
        lookup, construct, cursors, scatteringTensors)
      scatteringTensors = refreshed.scatteringTensors
      current = { ...current, sample: { ...current.sample, elementProfiles: refreshed.elementProfiles } }
    } else current = applyDatabaseValues(current, realDatabaseValues(current, tables, lookup, cursors))
    const pair = read(current, value)
    if (!pair.every(Number.isFinite)) throw new Error('Real spectrum exceeds the supported numerical range.')
    first.push(pair[0]); second.push(pair[1])
  }
  return { energy, first, second }
}

export function realScatteringFactors(project: Project, query: ElementSpectrumQuery, lookup: RealTableLookup, construct?: ScatteringTensorCalculator): LayerSpectrum {
  const element = project.sample.elementProfiles[query.elementIndex]
  if (project.sample.mode !== 'element' || !element) throw new Error('Select an element to show its scattering factors.')
  const energy = grid(project, query.tables, element.element, 'ff', true)
  return evaluate(project, query.tables, energy, lookup, current => {
    const row = current.sample.elementProfiles[query.elementIndex]
    return [row.f1, row.f2]
  }, construct)
}

export function realLayerSpectrum(project: Project, query: LayerSpectrumQuery, lookup: RealTableLookup, construct?: ScatteringTensorCalculator): LayerSpectrum {
  if (project.sample.mode === 'compound') {
    const layer = project.sample.layers[query.layerIndex]
    if (!layer) throw new Error('Select a layer to show its spectrum.')
    const energy = grid(project, query.tables, layer.opticalTable, query.magnetic ? 'm' : 'db', false)
    return evaluate(project, query.tables, energy, lookup, current => {
      const row = current.sample.layers[query.layerIndex]
      return query.magnetic ? [row.deltaMag, row.betaMag] : [row.delta, row.beta]
    })
  }
  if (query.magnetic) throw new Error('Element magnetic spectra are not available.')
  const element = project.sample.elementProfiles[query.elementIndex ?? 0]
  if (!element) throw new Error('Select an element to show its optical spectrum.')
  for (const row of project.sample.elementProfiles) {
    const slab = row.slabs[query.layerIndex]
    if (!slab || !Number.isFinite(slab.density)) throw new Error(`${row.element} needs a finite density at slab ${query.layerIndex}.`)
  }
  // Unlike the scattering-factor window, the optical window does not omit zero.
  const energy = grid(project, query.tables, element.element, 'ff', false)
  return evaluate(project, query.tables, energy, lookup, (current, value) => {
    let delta = 0, beta = 0
    for (const row of current.sample.elementProfiles) {
      const density = row.slabs[query.layerIndex].density
      // Preserve the original multiplication/division order, including both constants.
      delta += row.f1 * density / value / value * .0004151761541 * 1e6
      beta += row.f2 * density / value / value * .0004151761541 * 1e6
    }
    return [delta, beta]
  }, construct)
}
