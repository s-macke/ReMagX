import { createLayer } from './defaults'
import { layerSchema, type Layer } from './project'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import type { RealBeforeCalculation, RealCalculationEngine } from './realCalculation'
import { prepareRealSegmentedStack } from './segmentedCompoundStack'
import { prepareSampledElementLayers } from './sampledElementLayers'
import { prepareStandaloneQz } from './standaloneQz'

// Unit1.cpp profile handlers and Button13Click (To layer list): GetState,
// SetOCStrict, temporary BeforeCalculation, then force slicing for FillLayers.
export function prepareRealLayerList(original: Project, tables: OpticalTable[], engine: RealCalculationEngine,
  hook?: RealBeforeCalculation) {
  let { project, opticalState } = prepareStandaloneQz(original, tables, engine)
  if (project.scripts.enabled && project.scripts.beforeCalculation.trim()) {
    if (!hook) throw new Error('Layer preparation requires BeforeCalculation execution.')
    const result = hook(project, opticalState, 0, 'temporary')
    project = result.project; opticalState = result.opticalState
  }
  project = { ...project, calculation: { ...project.calculation, roughnessModel: 'segmentation' } }
  if (project.sample.mode === 'element') {
    if (!engine.elementPreparation) throw new Error('Element profiles require an explicit error-function lookup and numerical engine.')
    const stack = prepareSampledElementLayers(project, engine.elementPreparation.errorSamples,
      engine.elementPreparation, opticalState.scatteringTensors)
    return { ...stack, dielectricTensors: stack.dielectricTensors.map(values => values ? { values, anisotropic: true } : null) }
  }
  return prepareRealSegmentedStack(project, opticalState, engine)!
}

// Generated Schicht rows retain constructor density/escape-depth/material defaults.
// Button13Click only changes dbname to "unknown". Keep every generated row,
// including a possible single-row element result and the final nonzero thickness.
export function realLayerList(original: Project, tables: OpticalTable[], engine: RealCalculationEngine,
  hook?: RealBeforeCalculation): Layer[] {
  const stack = prepareRealLayerList(original, tables, engine, hook)
  return stack.layers.map((row, index) => {
    const tensor = stack.dielectricTensors[index]
    return layerSchema.parse(createLayer({ opticalTable: 'unknown',
      thickness: row[0], roughness: row[1], delta: row[2], beta: row[3], deltaMag: row[4], betaMag: row[5],
      magnetization: { gamma: row[6], phi: row[7] },
      ...(tensor ? { dielectricTensor: { values: Array.from(tensor.values), anisotropic: tensor.anisotropic } } : {}),
    }))
  })
}
