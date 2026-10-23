import { interpolateTable } from '../import/tables'
import type { Project } from '../model/project'
import { ComputeError, type ElementSpectrumQuery, type LayerSpectrumQuery, type LayerSpectrum } from './ComputeService'

// UI-phase table preview only. The real engine must refresh constants and execute
// BeforeCalculation at every energy, including tensor and element conversions.
export function mockLayerSpectrum(project: Project, query: LayerSpectrumQuery): LayerSpectrum {
  if (project.sample.mode === 'element') return mockElementOpticalSpectrum(project, query)
  const layer = project.sample.layers[query.layerIndex]
  if (!layer) throw new ComputeError('Select a layer to show its spectrum.')
  const name = layer.opticalTable.replace(/\\/g, '/').split('/').at(-1)!.replace(/\.(db|m|e)$/i, '')
  const kind = query.magnetic ? 'm' : 'db'
  const table = query.tables.find(table => table.name === name && table.kind === kind)
  if (!table || !table.energy.length) throw new ComputeError(`Load ${name || 'the selected material'}.${kind} in Sample → Optical Constants Database to show this spectrum.`)
  if (table.columns.length < 2 || table.columns.slice(0, 2).some(column => column.length !== table.energy.length || column.some(value => !Number.isFinite(value))) || table.energy.some(value => !Number.isFinite(value))) {
    throw new ComputeError(`The ${name}.${kind} table has invalid spectrum columns.`)
  }
  return { engine: 'mock', energy: [...table.energy], first: [...table.columns[0]], second: [...table.columns[1]] }
}

// Like the compound preview, this does not yet evaluate Filldb or Lua scripts.
export function mockScatteringFactors(project: Project, query: ElementSpectrumQuery): LayerSpectrum {
  const element = project.sample.elementProfiles[query.elementIndex]
  if (project.sample.mode !== 'element' || !element) throw new ComputeError('Select an element to show its scattering factors.')
  const name = element.element.replace(/\\/g, '/').split('/').at(-1)!.replace(/\.ff$/i, '')
  const table = query.tables.find(table => table.name === name && table.kind === 'ff')
  if (!table || !table.energy.length) throw new ComputeError(`Load ${name || 'the selected element'}.ff in Sample → Optical Constants Database to show scattering factors.`)
  if (table.columns.length !== 2 || table.columns.some(column => column.length !== table.energy.length || column.some(value => !Number.isFinite(value))) || table.energy.some(value => !Number.isFinite(value))) {
    throw new ComputeError(`The ${name}.ff table has invalid scattering-factor columns.`)
  }
  // The legacy plot omits zero-energy rows.
  const indices = table.energy.flatMap((energy, index) => energy === 0 ? [] : [index])
  if (!indices.length) throw new ComputeError(`The ${name}.ff table has no nonzero energies to plot.`)
  return { engine: 'mock', energy: indices.map(index => table.energy[index]), first: indices.map(index => table.columns[0][index]), second: indices.map(index => table.columns[1][index]) }
}

// Density-weighted slab preview. Linear interpolation/endpoint holding is mock-only;
// the real engine must evaluate Filldb and BeforeCalculation at each energy.
function mockElementOpticalSpectrum(project: Project, query: LayerSpectrumQuery): LayerSpectrum {
  if (query.magnetic) throw new ComputeError('Element magnetic spectra are not available.')
  const selected = query.elementIndex ?? 0
  const grid = mockScatteringFactors(project, { elementIndex: selected, tables: query.tables }).energy
  if (grid.some(energy => energy <= 0)) throw new ComputeError('Element optical spectrum energies must be positive.')
  const contributions = project.sample.elementProfiles.map((element, elementIndex) => {
    const slab = element.slabs[query.layerIndex]
    if (!slab || !Number.isFinite(slab.density) || slab.density < 0) throw new ComputeError(`${element.element} needs a valid density at slab ${query.layerIndex} to show this spectrum.`)
    const spectrum = mockScatteringFactors(project, { elementIndex, tables: query.tables })
    return { density: slab.density, table: { name: element.element, kind: 'ff' as const, energy: spectrum.energy, columns: [spectrum.first, spectrum.second], warnings: [] } }
  })
  const values = grid.map(energy => {
    const sum = [0, 0]
    for (const { density, table } of contributions) {
      const factors = interpolateTable(table, energy)!
      for (let column = 0; column < 2; column++) sum[column] += factors[column] * density * 415.1761541 / energy / energy
    }
    if (sum.some(value => !Number.isFinite(value))) throw new ComputeError('Element optical spectrum exceeds the supported numeric range.')
    return sum
  })
  return { engine: 'mock', energy: grid, first: values.map(value => value[0]), second: values.map(value => value[1]) }
}
