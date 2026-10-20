import type { OpticalTable } from '../import/tables'
import type { RealTableLookup } from './refreshOpticalConstants'
import type { ScriptElementBinding } from './scriptArrays'

export type ScriptFactorLookup = (element: ScriptElementBinding, energy: number) => void

/** Legacy ElementObject::setf: update one element at the exact supplied energy. */
export function createScriptFactorLookup(tables: readonly OpticalTable[], lookup: RealTableLookup,
  cursors = new Map<OpticalTable, number>()): ScriptFactorLookup {
  function read(table: OpticalTable, energy: number, width = 2) {
    const result = lookup(table, [energy], cursors.get(table) ?? 0)
    if (result.values.length !== width || !result.values.every(Number.isFinite)) {
      throw new Error(`Invalid scattering factors in ${table.name}.${table.kind}`)
    }
    cursors.set(table, result.cursor)
    return result.values
  }
  return (element, energy) => {
    if (!Number.isFinite(energy)) throw new Error('element.setf: energy must be finite')
    const primary = tables.find(table => table.name === element.name && table.kind === 'ff')
    // Missing/empty/out-of-range primary data leaves all four factors unchanged.
    if (!primary?.energy.length || energy < primary.energy[0] || energy > primary.energy.at(-1)!) return
    const values = read(primary, energy)
    const magnetic = tables.find(table => table.name === element.name && table.kind === 'ffm' && table.energy.length)
    // Out-of-range magnetic lookup deliberately runs: native Get returns zeros.
    const magneticValues = magnetic ? read(magnetic, energy) : [0, 0]
    // Getff also advances the full tensor table cursor, but setf copies only scalar factors.
    const tensor = tables.find(table => table.name === element.name && table.kind === 'f' && table.energy.length)
    if (tensor) read(tensor, energy, 18)
    element.setFactor('f1', values[0]); element.setFactor('f2', values[1])
    element.setFactor('f1Mag', magneticValues[0]); element.setFactor('f2Mag', magneticValues[1])
  }
}
