import type { OpticalTable } from '../import/tables'
import type { Project } from './project'

export type RealTableLookup = (table: OpticalTable, queries: number[], cursor: number) => {
  values: Float64Array
  cursor: number
}

export class OpticalTableRangeError extends Error {}

// Compound branch of MaterialConstantsHelper.cpp Filldb / CMaterialConstants::Getdb.
// Called inside the compute worker with the native table lookup implementation.
// The caller supplies the calculation energy (including any legacy conversion).
export function refreshCompoundConstants(project: Project, tables: OpticalTable[], energy: number, lookup: RealTableLookup, cursors = new Map<OpticalTable, number>()): Project['sample']['layers'] {
  if (project.sample.mode !== 'compound') throw new Error('Real optical-table refresh for element mode is not implemented yet.')
  if (!Number.isFinite(energy) || energy <= 0) throw new Error('Optical-table refresh needs a positive finite energy.')
  let rangeError = ''
  const read = (table: OpticalTable): Float64Array => {
    const result = lookup(table, [energy], cursors.get(table) ?? 0)
    if (result.values.length !== 2 || !result.values.every(Number.isFinite)) throw new Error(`Invalid optical constants in ${table.name}.${table.kind}.`)
    cursors.set(table, result.cursor)
    return result.values
  }
  const layers = project.sample.layers.map((layer, index) => {
    // Findoc uses exact material names, without case folding or path rewriting.
    const name = layer.opticalTable
    const table = name ? tables.find(candidate => candidate.name === name && candidate.kind === 'db') : undefined
    if (!table || !table.energy.length) throw new Error(`Layer ${index}: missing optical table ${name || '(unnamed)'}.db.`)
    if (energy < table.energy[0] || energy > table.energy.at(-1)!) {
      rangeError = `Layer ${index}: ${energy} eV is outside ${name}.db.`
      return { ...layer } // Filldb continues refreshing other layers before returning false.
    }
    if (tables.some(candidate => candidate.name === name && candidate.kind === 'e' && candidate.energy.length)) {
      throw new Error(`Layer ${index}: real dielectric-tensor table refresh is not implemented yet (${name}.e).`)
    }
    const primary = read(table)
    const magneticTable = tables.find(candidate => candidate.name === name && candidate.kind === 'm')
    // Getdb skips empty magnetic tables; Get returns zeros outside their range.
    const magnetic = magneticTable?.energy.length ? read(magneticTable) : [0, 0]
    return { ...layer, delta: primary[0], beta: primary[1], deltaMag: magnetic[0], betaMag: magnetic[1] }
  })
  if (rangeError) throw new OpticalTableRangeError(rangeError)
  return layers
}
