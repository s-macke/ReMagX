import type { Project } from '../model/project'
import { ComputeError, type LayerSpectrumQuery, type LayerSpectrum } from './ComputeService'

// UI-phase table preview only. The real engine must refresh constants and execute
// BeforeCalculation at every energy, including tensor and element conversions.
export function mockLayerSpectrum(project: Project, query: LayerSpectrumQuery): LayerSpectrum {
  if (project.sample.mode !== 'compound') throw new ComputeError('Element optical spectra are not available in the mock engine yet.')
  const layer = project.sample.layers[query.layerIndex]
  if (!layer) throw new ComputeError('Select a layer to show its spectrum.')
  const name = layer.opticalTable.replace(/\\/g, '/').split('/').at(-1)!.replace(/\.(db|m|e)$/i, '')
  const kind = query.magnetic ? 'm' : 'db'
  const table = query.tables.find(table => table.name === name && table.kind === kind)
  if (!table || !table.energy.length) throw new ComputeError(`Load ${name || 'the selected material'}.${kind} in Sample → Optical Constants Database to show this spectrum.`)
  if (table.columns.length < 2 || table.columns.slice(0, 2).some(column => column.length !== table.energy.length || column.some(value => !Number.isFinite(value))) || table.energy.some(value => !Number.isFinite(value))) {
    throw new ComputeError(`The ${name}.${kind} table has invalid spectrum columns.`)
  }
  return { energy: [...table.energy], first: [...table.columns[0]], second: [...table.columns[1]] }
}
