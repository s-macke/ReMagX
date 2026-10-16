import { interpolateTable, type OpticalTable } from '../import/tables'
import type { DatabaseValues } from '../model/databaseValues'
import type { Project } from '../model/project'
import { ComputeError } from './ComputeService'

// UI-phase linear interpolation. The real engine must supply legacy interpolation,
// built-in data and dielectric/scattering tensors behind this same service request.
export function mockDatabaseValues(project: Project, tables: OpticalTable[]): DatabaseValues {
  const energy = project.experiment.energy
  if (!Number.isFinite(energy) || energy <= 0) throw new ComputeError('Set a positive photon energy before updating database values.')
  const mode = project.sample.mode
  const primaryKind = mode === 'compound' ? 'db' : 'ff'
  const magneticKind = mode === 'compound' ? 'm' : 'ffm'
  const names = mode === 'compound' ? project.sample.layers.map(layer => layer.opticalTable) : project.sample.elementProfiles.map(element => element.element)
  const result: DatabaseValues = { mode, updates: [], warnings: [] }
  names.forEach((sourceName, index) => {
    const name = sourceName.replace(/\\/g, '/').split('/').at(-1)!.replace(/\.(db|m|e|ff|ffm)$/i, '')
    const label = `${mode === 'compound' ? 'Layer' : 'Element'} ${index}: ${name || '(no table name)'}`
    const table = tables.find(table => table.name === name && table.kind === primaryKind)
    if (!table || !table.energy.length) { result.warnings.push(`${label}: no ${primaryKind} table; values kept.`); return }
    if (energy < table.energy[0] || energy > table.energy.at(-1)!) { result.warnings.push(`${label}: ${energy} eV is outside the ${primaryKind} table; values kept.`); return }
    const primary = interpolateTable(table, energy)
    const magnetic = tables.find(table => table.name === name && table.kind === magneticKind && table.energy.length)
    const mag = magnetic ? interpolateTable(magnetic, energy) : [0, 0]
    if (!primary || !mag || primary.length !== 2 || mag.length !== 2 || [...primary, ...mag].some(value => !Number.isFinite(value))) {
      result.warnings.push(`${label}: invalid table values; values kept.`); return
    }
    if (magnetic && (energy < magnetic.energy[0] || energy > magnetic.energy.at(-1)!)) result.warnings.push(`${label}: mock magnetic interpolation holds the nearest table endpoint outside its range.`)
    if (!magnetic) result.warnings.push(`${label}: no ${magneticKind} table; magnetic values set to zero.`)
    if (tables.some(table => table.name === name && table.kind === 'e')) result.warnings.push(`${label}: dielectric tensor data is retained in the library but is not applied by the mock.`)
    result.updates.push({ index, first: primary[0], second: primary[1], firstMag: mag[0], secondMag: mag[1] })
  })
  return result
}
