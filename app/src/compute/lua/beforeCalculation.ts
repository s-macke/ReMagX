import { createScatteringTensorWorkspace } from '../../model/scatteringTensors'
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
  tables: OpticalTable[], emit: (message: string) => void = () => {},
  resolvedTables = new Map<number, OpticalTable>()): RealBeforeCalculation {
  return createProjectScript('BeforeCalculation', session, engine, tables, emit, resolvedTables)
}

/** Bind one selected legacy program to caller-prepared project/optical state.
 * The caller owns refresh, invocation and disposal. Explicit execution may run
 * even when automatic scripts are disabled; the stored preference is preserved.
 */
export function createProjectScript(name: 'Default' | 'BeforeCalculation', session: LuaSession,
  engine: RealCalculationEngine, tables: OpticalTable[], emit: (message: string) => void = () => {},
  resolvedTables = new Map<number, OpticalTable>()): RealBeforeCalculation {
  const scriptKey = name === 'Default' ? 'default' : 'beforeCalculation'
  let context: { scattering: ReturnType<typeof createScatteringTensorWorkspace>; workspace: ReturnType<typeof createScriptArrayWorkspace>; tensors: ReturnType<typeof createScriptTensorWorkspace>; source: string } | undefined
  const cursors = new Map<OpticalTable, number>()
  return (project, opticalState, renewOpticalConstants = 0) => {
    try {
      if (opticalState.cursors !== cursors) {
        cursors.clear()
        for (const [table, cursor] of opticalState.cursors) cursors.set(table, cursor)
      }
      const initial = project.sample.layers.map((layer, index) => {
        const retained = opticalState.dielectricState?.[index]
        if (retained) return retained
        const override = opticalState.dielectricTensors[index]
        return override ? { values: override, anisotropic: true } : engine.dielectricTensor({
          layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag,
            layer.magnetization.gamma, layer.magnetization.phi],
          tensor: project.calculation.tensorContribution === 'tetragonal' ? 1 : 0,
          magnetic: project.calculation.magnetization.mode === 'none' ? 0 : 1,
        })
      })
      const initialScattering = opticalState.scatteringTensors ?? project.sample.elementProfiles.map(() => new Float64Array(18))
      if (initialScattering.length !== project.sample.elementProfiles.length) throw new Error('Scattering tensor element count changed')
      if (!context) {
        const workspace = createScriptArrayWorkspace(project)
        const tensors = createScriptTensorWorkspace(initial)
        const scattering = createScatteringTensorWorkspace(initialScattering)
        const solution = createScriptSolutionWorkspace()
        const optics = createScriptOptics(workspace, tensors, tables, engine.lookup, engine.dielectricTensor, cursors, resolvedTables,
          { workspace: scattering, construct: request => {
            if (!engine.scatteringTensor) throw new Error('FillTensors: native element scattering tensors are not available')
            return engine.scatteringTensor(request)
          } })
        session.installOutput(emit)
        session.installElements(workspace.elements, createScriptFactorLookup(tables, engine.lookup, cursors))
        session.installArrays(new Map([...workspace.arrays, ...solution.arrays, ...tensors.arrays]), solution.dynamicMaximumIndex)
        session.installProjectFunctions({ ...workspace, ...optics,
          gaussLorentzianReal: (center, area, width, mixingPercent) => {
            if (!engine.gaussLorentzianReal) throw new Error('GetGaussLorentzianReal: native line-shape calculation is not available')
            return engine.gaussLorentzianReal(workspace.calculationEnergy(), center, area, width, mixingPercent)
          },
          gaussLorentzianImag: (center, area, width, mixingPercent) => {
            if (!engine.gaussLorentzianImag) throw new Error('GetGaussLorentzianImag: native line-shape calculation is not available')
            return engine.gaussLorentzianImag(workspace.calculationEnergy(), center, area, width, mixingPercent)
          } })
        session.compile(project.scripts[scriptKey], name)
        context = { scattering, workspace, tensors, source: project.scripts[scriptKey] }
      } else {
        if (project.scripts[scriptKey] !== context.source) throw new Error(`${name} source changed; create a new session`)
        context.tensors.replace(initial)
        context.scattering.replace(initialScattering)
      }
      const { workspace, tensors } = context
      workspace.replace(project, renewOpticalConstants)
      const result = runProjectHook(session, workspace)
      return { project: result, opticalState: { layers: result.sample.layers, dielectricTensors: tensors.overrides(), dielectricState: tensors.snapshot(), scatteringTensors: context.scattering.snapshot(), cursors: new Map(cursors) } }
    } catch (error) {
      session.close()
      throw error
    }
  }
}
