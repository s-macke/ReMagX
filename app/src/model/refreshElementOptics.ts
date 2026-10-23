import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealTableLookup } from './refreshOpticalConstants'
import { copyScatteringTensors, type ScatteringTensorCalculator } from './scatteringTensors'

// Filldb element branch for .ff/.ffm tables. Imported .F overrides require a
// decision about the original cross-element row assignment before evaluation.
// Caller supplies the stored calculation energy; cursors are calculation-owned.
export function refreshElementOptics(project: Project, tables: readonly OpticalTable[], energy: number,
  lookup: RealTableLookup, construct: ScatteringTensorCalculator, cursors = new Map<OpticalTable, number>(),
  previousTensors?: readonly Float64Array[]) {
  if (project.sample.mode !== 'element') throw new Error('Element optical refresh requires element mode.')
  if (!Number.isFinite(energy) || energy <= 0) throw new Error('Element optical refresh needs a positive finite energy.')
  if (previousTensors && previousTensors.length !== project.sample.elementProfiles.length) {
    throw new Error('Element scattering tensor count changed.')
  }
  const scatteringTensors = previousTensors ? copyScatteringTensors(previousTensors)
    : project.sample.elementProfiles.map(() => new Float64Array(18))
  const updated = project.sample.elementProfiles.map(() => false)
  let rangeError: string | null = null
  const read = (table: OpticalTable) => {
    const result = lookup(table, [energy], cursors.get(table) ?? 0)
    if (result.values.length !== 2 || !result.values.every(Number.isFinite)) throw new Error(`Invalid element factors in ${table.name}.${table.kind}.`)
    cursors.set(table, result.cursor)
    return result.values
  }
  const elementProfiles = project.sample.elementProfiles.map((profile, index) => {
    const primary = profile.element ? tables.find(table => table.name === profile.element && table.kind === 'ff') : undefined
    if (!primary?.energy.length) {
      rangeError = `Element ${index}: missing ${profile.element || '(unnamed)'}.ff table.`
      return { ...profile }
    }
    if (energy < primary.energy[0] || energy > primary.energy.at(-1)!) {
      rangeError = `Element ${index}: ${energy} eV is outside ${profile.element}.ff.`
      return { ...profile }
    }
    if (tables.some(table => table.name === profile.element && table.kind === 'f' && table.energy.length)) {
      throw new Error('Full .F scattering tensor refresh is unavailable pending the legacy element-assignment decision.')
    }
    const scalar = read(primary)
    const magneticTable = tables.find(table => table.name === profile.element && table.kind === 'ffm')
    const magnetic = magneticTable?.energy.length ? read(magneticTable) : [0, 0]
    const refreshed = { ...profile, f1: scalar[0], f2: scalar[1], f1Mag: magnetic[0], f2Mag: magnetic[1] }
    const tensor = construct({ factors: [refreshed.f1, refreshed.f2, refreshed.f1Mag, refreshed.f2Mag],
      gamma: project.calculation.magnetization.direction.gamma, phi: project.calculation.magnetization.direction.phi,
      tensor: project.calculation.tensorContribution === 'tetragonal' ? 1 : 0,
      magnetic: project.calculation.magnetization.mode === 'none' ? 0 : 1 })
    scatteringTensors[index] = copyScatteringTensors([tensor])[0]
    updated[index] = true
    return refreshed
  })
  return { elementProfiles, scatteringTensors, updated, rangeError }
}
