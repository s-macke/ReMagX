import { createScriptArrayWorkspace } from '../../model/scriptArrays'
import { createScriptTensorWorkspace } from '../../model/scriptTensors'
import { createScriptSolutionWorkspace } from '../../model/scriptSolution'
import { createScriptFactorLookup } from '../../model/scriptFactors'
import { createScriptOptics } from '../../model/scriptOptics'
import type { RealBeforeCalculation, RealCalculationEngine } from '../../model/realCalculation'
import type { OpticalTable } from '../../import/tables'
import type { LuaSession } from './runtime'
import { runProjectHook } from './projectHook'

/** One standalone qz calculation; persistent fit/energy sessions are separate work. */
export function createBeforeCalculation(session: LuaSession, engine: RealCalculationEngine,
  tables: OpticalTable[], automatic: boolean, emit: (message: string) => void = () => {}): RealBeforeCalculation {
  return (project, opticalState) => {
    const workspace = createScriptArrayWorkspace(project)
    const initial = project.sample.layers.map((layer, index) => {
      const override = opticalState.dielectricTensors[index]
      return override ? { values: override, anisotropic: true } : engine.dielectricTensor({
        layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag,
          layer.magnetization.gamma, layer.magnetization.phi],
        tensor: project.calculation.tensorContribution === 'tetragonal' ? 1 : 0,
        magnetic: project.calculation.magnetization.mode === 'none' ? 0 : 1,
      })
    })
    const tensors = createScriptTensorWorkspace(initial)
    const solution = createScriptSolutionWorkspace()
    const resolved = new Map<number, OpticalTable>()
    if (automatic) project.sample.layers.forEach((layer, index) => {
      const table = tables.find(table => table.name === layer.opticalTable && table.kind === 'db')
      if (table) resolved.set(index, table)
    })
    const optics = createScriptOptics(workspace, tensors, tables, engine.lookup, engine.dielectricTensor, opticalState.cursors, resolved)
    session.installOutput(emit)
    session.installElements(workspace.elements, createScriptFactorLookup(tables, engine.lookup, opticalState.cursors))
    session.installArrays(new Map([...workspace.arrays, ...solution.arrays, ...tensors.arrays]), solution.dynamicMaximumIndex)
    session.installProjectFunctions({ ...workspace, ...optics })
    session.compile(project.scripts.beforeCalculation, 'BeforeCalculation')
    const result = runProjectHook(session, workspace)
    return { project: result, opticalState: { layers: result.sample.layers, dielectricTensors: tensors.overrides(), cursors: opticalState.cursors } }
  }
}
