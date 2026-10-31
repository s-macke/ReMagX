import { evaluateCompoundSpectrum } from './compoundSpectrum'
import type { RealBeforeCalculation } from './realCalculation'
import { evaluateElementSpectrum } from './elementSpectrum'
import type { ScatteringTensorCalculator } from './scatteringTensors'
import type { ElementSpectrumQuery, LayerSpectrumQuery, LayerSpectrum } from '../compute/ComputeService'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealTableLookup } from './refreshOpticalConstants'

function grid(project: Project, tables: OpticalTable[], name: string, kind: OpticalTable['kind'], skipZero: boolean, scripted = false) {
  if (!scripted && project.scripts.enabled && project.scripts.beforeCalculation.trim()) {
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

export function realScatteringFactors(project: Project, query: ElementSpectrumQuery, lookup: RealTableLookup, construct?: ScatteringTensorCalculator, beforeCalculation?: RealBeforeCalculation): LayerSpectrum {
  const element = project.sample.elementProfiles[query.elementIndex]
  if (project.sample.mode !== 'element' || !element) throw new Error('Select an element to show its scattering factors.')
  const energy = grid(project, query.tables, element.element, 'ff', true, !!beforeCalculation)
  if (!construct) throw new Error('Native element tensor construction is unavailable.')
  return evaluateElementSpectrum(project, query.tables, energy, lookup, construct, current => {
    const row = current.sample.elementProfiles[query.elementIndex]
    return [row.f1, row.f2]
  }, beforeCalculation)
}

export function realLayerSpectrum(project: Project, query: LayerSpectrumQuery, lookup: RealTableLookup, construct?: ScatteringTensorCalculator, beforeCalculation?: RealBeforeCalculation): LayerSpectrum {
  if (project.sample.mode === 'compound') {
    const layer = project.sample.layers[query.layerIndex]
    if (!layer) throw new Error('Select a layer to show its spectrum.')
    const energy = grid(project, query.tables, layer.opticalTable, query.magnetic ? 'm' : 'db', false, !!beforeCalculation)
    return evaluateCompoundSpectrum(project, query.tables, energy, lookup, current => {
      const row = current.sample.layers[query.layerIndex]
      return query.magnetic ? [row.deltaMag, row.betaMag] : [row.delta, row.beta]
    }, beforeCalculation)
  }
  if (query.magnetic) throw new Error('Element magnetic spectra are not available.')
  const element = project.sample.elementProfiles[query.elementIndex ?? 0]
  if (!element) throw new Error('Select an element to show its optical spectrum.')
  // D-59: layerIndex is the selected logical element slab here, independent of
  // stored compound row count (the original spectrum handler mixed these counts).
  for (const row of project.sample.elementProfiles) {
    const slab = row.slabs[query.layerIndex]
    if (!slab || !Number.isFinite(slab.density)) throw new Error(`${row.element} needs a finite density at slab ${query.layerIndex}.`)
  }
  // Unlike the scattering-factor window, the optical window does not omit zero.
  const energy = grid(project, query.tables, element.element, 'ff', false, !!beforeCalculation)
  if (!construct) throw new Error('Native element tensor construction is unavailable.')
  return evaluateElementSpectrum(project, query.tables, energy, lookup, construct, (current, value) => {
    let delta = 0, beta = 0
    for (const row of current.sample.elementProfiles) {
      const density = row.slabs[query.layerIndex].density
      // Preserve the original multiplication/division order, including both constants.
      delta += row.f1 * density / value / value * .0004151761541 * 1e6
      beta += row.f2 * density / value / value * .0004151761541 * 1e6
    }
    return [delta, beta]
  }, beforeCalculation)
}
