import { createScriptArrayWorkspace } from '../../model/scriptArrays'
import { createScriptTensorWorkspace } from '../../model/scriptTensors'
import { createScriptSolutionWorkspace } from '../../model/scriptSolution'
import { createScriptFactorLookup } from '../../model/scriptFactors'
import { createScriptOptics } from '../../model/scriptOptics'
import type { RealBeforeCalculation, RealCalculationEngine } from '../../model/realCalculation'
import type { OpticalTable } from '../../import/tables'
import type { LuaSession } from './runtime'
import { runProjectHook } from './projectHook'

/** Reusable calculation-owned hook; its caller determines scan/fit invocation order. */
export function createBeforeCalculation(session: LuaSession, engine: RealCalculationEngine,
  tables: OpticalTable[], emit: (message: string) => void = () => {}): RealBeforeCalculation {
  let context: { workspace: ReturnType<typeof createScriptArrayWorkspace>; tensors: ReturnType<typeof createScriptTensorWorkspace>; source: string } | undefined
  const cursors = new Map<OpticalTable, number>()
  return (project, opticalState) => {
    try {
      if (opticalState.cursors !== cursors) {
        cursors.clear()
        for (const [table, cursor] of opticalState.cursors) cursors.set(table, cursor)
      }
      const initial = project.sample.layers.map((layer, index) => {
        const override = opticalState.dielectricTensors[index]
        return override ? { values: override, anisotropic: true } : engine.dielectricTensor({
          layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag,
            layer.magnetization.gamma, layer.magnetization.phi],
          tensor: project.calculation.tensorContribution === 'tetragonal' ? 1 : 0,
          magnetic: project.calculation.magnetization.mode === 'none' ? 0 : 1,
        })
      })
      if (!context) {
        const workspace = createScriptArrayWorkspace(project)
        const tensors = createScriptTensorWorkspace(initial)
        const solution = createScriptSolutionWorkspace()
        const optics = createScriptOptics(workspace, tensors, tables, engine.lookup, engine.dielectricTensor, cursors)
        session.installOutput(emit)
        session.installElements(workspace.elements, createScriptFactorLookup(tables, engine.lookup, cursors))
        session.installArrays(new Map([...workspace.arrays, ...solution.arrays, ...tensors.arrays]), solution.dynamicMaximumIndex)
        session.installProjectFunctions({ ...workspace, ...optics })
        session.compile(project.scripts.beforeCalculation, 'BeforeCalculation')
        context = { workspace, tensors, source: project.scripts.beforeCalculation }
      } else {
        if (project.scripts.beforeCalculation !== context.source) throw new Error('BeforeCalculation source changed; create a new session')
        context.workspace.replace(project)
        context.tensors.replace(initial)
      }
      const { workspace, tensors } = context
      const result = runProjectHook(session, workspace)
      return { project: result, opticalState: { layers: result.sample.layers, dielectricTensors: tensors.overrides(), cursors: new Map(cursors) } }
    } catch (error) {
      session.close()
      throw error
    }
  }
}
