import type { ScriptDielectricTensor } from './scriptTensors'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'

export type RealTableLookup = (table: OpticalTable, queries: number[], cursor: number) => {
  values: Float64Array
  cursor: number
}

export class OpticalTableRangeError extends Error {}

export interface SerialOpticalState extends CompoundOpticalState {
  cursors: Map<OpticalTable, number>
}

export interface CompoundOpticalState {
  layers: Project['sample']['layers']
  dielectricTensors: (Float64Array | null)[]
  dielectricState?: (ScriptDielectricTensor | null)[]
}

// Filldb can update some layers even when another layer is outside its table.
// Keep this state available to serial scan/fit orchestration without mutating inputs.
export function refreshCompoundOpticsState(project: Project, tables: OpticalTable[], energy: number,
  lookup: RealTableLookup, cursors = new Map<OpticalTable, number>(),
  previousTensors?: (Float64Array | null)[]): CompoundOpticalState & { rangeError: string | null; updated: boolean[] } {
  if (previousTensors && previousTensors.length !== project.sample.layers.length) {
    throw new Error('Optical tensor state must match the layer count.')
  }
  return refreshState(project, tables, energy, lookup, cursors, previousTensors)
}

// Preserve Filldb's partial updates and failure status; each caller decides whether to skip.
export function refreshPartialCompoundOptics(project: Project, tables: OpticalTable[], energy: number,
  lookup: RealTableLookup, cursors = new Map<OpticalTable, number>(), previousTensors?: (Float64Array | null)[]) {
  if (previousTensors && previousTensors.length !== project.sample.layers.length) {
    throw new Error('Optical tensor state must match the layer count.')
  }
  return refreshState(project, tables, energy, lookup, cursors, previousTensors, 'retain')
}

// Compound branch of MaterialConstantsHelper.cpp Filldb / CMaterialConstants::Getdb.
// Called inside the compute worker with the native table lookup implementation.
// The caller supplies the calculation energy (including any legacy conversion).
export function refreshCompoundOptics(project: Project, tables: OpticalTable[], energy: number, lookup: RealTableLookup,
  cursors = new Map<OpticalTable, number>()): CompoundOpticalState {
  const result = refreshCompoundOpticsState(project, tables, energy, lookup, cursors)
  if (result.rangeError) throw new OpticalTableRangeError(result.rangeError)
  return { layers: result.layers, dielectricTensors: result.dielectricTensors }
}

function refreshState(project: Project, tables: OpticalTable[], energy: number, lookup: RealTableLookup,
  cursors: Map<OpticalTable, number>, previousTensors?: (Float64Array | null)[], missing: 'reject' | 'retain' = 'reject'): CompoundOpticalState & { rangeError: string | null; updated: boolean[] } {
  if (project.sample.mode !== 'compound') throw new Error('Real optical-table refresh for element mode is not implemented yet.')
  if (!Number.isFinite(energy) || energy <= 0) throw new Error('Optical-table refresh needs a positive finite energy.')
  let rangeError = ''
  const updated = project.sample.layers.map(() => false)
  const dielectricTensors: (Float64Array | null)[] = project.sample.layers.map((_, index) => previousTensors?.[index]?.slice() ?? null)
  const read = (table: OpticalTable, width = 2): Float64Array => {
    const result = lookup(table, [energy], cursors.get(table) ?? 0)
    if (result.values.length !== width || !result.values.every(Number.isFinite)) throw new Error(`Invalid optical constants in ${table.name}.${table.kind}.`)
    cursors.set(table, result.cursor)
    return result.values
  }
  const layers = project.sample.layers.map((layer, index) => {
    // Findoc uses exact material names, without case folding or path rewriting.
    const name = layer.opticalTable
    const table = name ? tables.find(candidate => candidate.name === name && candidate.kind === 'db') : undefined
    if (!table || !table.energy.length) {
      const message = `Layer ${index}: missing optical table ${name || '(unnamed)'}.db.`
      if (missing === 'reject') throw new Error(message)
      rangeError = message
      return { ...layer }
    }
    if (energy < table.energy[0] || energy > table.energy.at(-1)!) {
      rangeError = `Layer ${index}: ${energy} eV is outside ${name}.db.`
      return { ...layer } // Filldb continues refreshing other layers before returning false.
    }
    const primary = read(table)
    updated[index] = true
    const magneticTable = tables.find(candidate => candidate.name === name && candidate.kind === 'm')
    // Getdb skips empty magnetic tables; Get returns zeros outside their range.
    const magnetic = magneticTable?.energy.length ? read(magneticTable) : [0, 0]
    const tensorTable = tables.find(candidate => candidate.name === name && candidate.kind === 'e')
    // Getdb marks any nonempty .e table anisotropic, even out-of-range zeros.
    dielectricTensors[index] = tensorTable?.energy.length ? read(tensorTable, 18).slice() : null
    return { ...layer, delta: primary[0], beta: primary[1], deltaMag: magnetic[0], betaMag: magnetic[1] }
  })
  return { layers, dielectricTensors, rangeError: rangeError || null, updated }
}

// Scalar callers still perform the full Getdb lookup sequence. Parratt uses the
// refreshed scalar fields and does not consume the tensor, as in legacy code.
export function refreshCompoundConstants(project: Project, tables: OpticalTable[], energy: number,
  lookup: RealTableLookup, cursors = new Map<OpticalTable, number>()): Project['sample']['layers'] {
  return refreshCompoundOptics(project, tables, energy, lookup, cursors).layers
}
