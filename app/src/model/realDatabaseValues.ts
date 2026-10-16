import type { OpticalTable } from '../import/tables'
import type { DatabaseValues } from './databaseValues'
import type { Project } from './project'
import type { RealTableLookup } from './refreshOpticalConstants'
import { HC_EV_ANGSTROM } from './units'

// Scalar Getdb/Getff fields for the explicit database-update action. Numerical
// interpolation (including out-of-range magnetic zeros) is delegated to WASM.
export function realDatabaseValues(project: Project, tables: OpticalTable[], lookup: RealTableLookup): DatabaseValues {
  if (!Number.isFinite(project.experiment.energy) || project.experiment.energy <= 0) {
    throw new Error('Set a positive photon energy before updating database values.')
  }
  const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy)
  const mode = project.sample.mode
  const primaryKind = mode === 'compound' ? 'db' : 'ff'
  const magneticKind = mode === 'compound' ? 'm' : 'ffm'
  const names = mode === 'compound' ? project.sample.layers.map(layer => layer.opticalTable)
    : project.sample.elementProfiles.map(element => element.element)
  const result: DatabaseValues = { mode, updates: [], warnings: [] }
  const cursors = new Map<OpticalTable, number>()
  const read = (table: OpticalTable) => {
    const found = lookup(table, [energy], cursors.get(table) ?? 0)
    if (found.values.length !== 2 || !found.values.every(Number.isFinite)) throw new Error(`Invalid scalar values in ${table.name}.${table.kind}.`)
    cursors.set(table, found.cursor)
    return found.values
  }
  names.forEach((name, index) => {
    // Findoc matches exact names, unlike the UI-phase mock's filename cleanup.
    const label = `${mode === 'compound' ? 'Layer' : 'Element'} ${index}: ${name || '(no table name)'}`
    const primary = tables.find(table => table.name === name && table.kind === primaryKind && name !== '')
    if (!primary?.energy.length) {
      result.warnings.push(`${label}: no ${primaryKind} table; values kept.${mode === 'element' ? ' Built-in element tables are not available yet.' : ''}`)
      return
    }
    if (energy < primary.energy[0] || energy > primary.energy.at(-1)!) {
      result.warnings.push(`${label}: ${energy} eV is outside the ${primaryKind} table; values kept.`)
      return
    }
    const values = read(primary)
    const magnetic = tables.find(table => table.name === name && table.kind === magneticKind && table.energy.length)
    const magneticValues = magnetic ? read(magnetic) : [0, 0]
    if (!magnetic) result.warnings.push(`${label}: no ${magneticKind} table; magnetic values set to zero.`)
    else if (energy < magnetic.energy[0] || energy > magnetic.energy.at(-1)!) {
      result.warnings.push(`${label}: ${energy} eV is outside the ${magneticKind} table; magnetic values set to zero.`)
    }
    if (mode === 'compound' && tables.some(table => table.name === name && table.kind === 'e' && table.energy.length)) {
      result.warnings.push(`${label}: this action updates scalar fields only; tensor data remains in the table library for automatic real calculations.`)
    }
    result.updates.push({ index, first: values[0], second: values[1], firstMag: magneticValues[0], secondMag: magneticValues[1] })
  })
  return result
}
