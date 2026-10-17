import type { OpticalTable } from '../import/tables'
import type { createScriptArrayWorkspace } from './scriptArrays'
import type { createScriptTensorWorkspace } from './scriptTensors'
import type { DielectricTensorCalculator } from './visnovskyRequest'
import type { RealTableLookup } from './refreshOpticalConstants'

export function createScriptOptics(workspace: ReturnType<typeof createScriptArrayWorkspace>,
  tensors: ReturnType<typeof createScriptTensorWorkspace>, tables: readonly OpticalTable[],
  lookup: RealTableLookup, construct: DielectricTensorCalculator, cursors = new Map<OpticalTable, number>(),
  resolvedTables = new Map<number, OpticalTable>()) {
  function compound() {
    const project = workspace.snapshot()
    if (project.sample.mode !== 'compound') throw new Error('Element active-film optics are not supported yet')
    return project
  }
  function read(table: OpticalTable, energy: number, width: number) {
    const result = lookup(table, [energy], cursors.get(table) ?? 0)
    if (result.values.length !== width || !result.values.every(Number.isFinite)) throw new Error(`Invalid ${table.name}.${table.kind} values`)
    cursors.set(table, result.cursor)
    return result.values
  }
  return {
    fillTensors(): void {
      const project = compound()
      if (project.sample.elementProfiles.length) throw new Error('FillTensors: element scattering tensors are not supported yet')
      const next = project.sample.layers.map(layer => construct({
        layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag,
          layer.magnetization.gamma, layer.magnetization.phi],
        tensor: project.calculation.tensorContribution === 'tetragonal' ? 1 : 0,
        magnetic: project.calculation.magnetization.mode === 'none' ? 0 : 1,
      }))
      tensors.replace(next)
    },
    setDeltaBeta(index: number, energy: number): void {
      const project = compound()
      if (!Number.isSafeInteger(index) || index < 0 || index >= project.sample.layers.length) throw new Error('SetDeltaBeta: layer index out of range')
      if (!Number.isFinite(energy)) throw new Error('SetDeltaBeta: energy must be finite')
      const layer = project.sample.layers[index]
      let primary = resolvedTables.get(index)
      if (!primary) {
        primary = tables.find(table => table.kind === 'db' && table.name === layer.opticalTable)
        if (primary) resolvedTables.set(index, primary)
      }
      if (!primary?.energy.length || energy < primary.energy[0] || energy > primary.energy.at(-1)!) return
      const scalar = read(primary, energy, 2)
      const magnetic = tables.find(table => table.kind === 'm' && table.name === primary.name)
      const magneticValues = magnetic?.energy.length ? read(magnetic, energy, 2) : [0, 0]
      const tensor = tables.find(table => table.kind === 'e' && table.name === primary.name)
      // Getdb returns a default zero tensor unless an imported tensor exists.
      const next = tensors.snapshot()
      next[index] = tensor?.energy.length
        ? { values: read(tensor, energy, 18), anisotropic: true }
        : { values: new Float64Array(18), anisotropic: false }
      tensors.replace(next)
      for (const [name, value] of [['delta', scalar[0]], ['beta', scalar[1]],
        ['deltam', magneticValues[0]], ['betam', magneticValues[1]]] as const) {
        workspace.arrays.get(name)!.write(index, value)
      }
    },
  }
}
