import type { OpticalTable } from '../import/tables'
import type { DatabaseValues } from './databaseValues'
import type { Project } from './project'
import { prepareProjectOptics } from './projectOptics'
import { refreshPartialCompoundOptics } from './refreshOpticalConstants'
import { refreshElementOptics } from './refreshElementOptics'
import { copyScriptTensors } from './scriptTensors'
import { HC_EV_ANGSTROM } from './units'

// GetdbButtonClick performs GetState, then an unconditional Filldb, and copies
// both arrays of the active film back, including skipped and inactive manual tensors.
export function realDatabaseValues(project: Project, tables: OpticalTable[], engine: Parameters<typeof prepareProjectOptics>[2]): DatabaseValues {
  if (!Number.isFinite(project.experiment.energy) || project.experiment.energy <= 0) {
    throw new Error('Set a positive photon energy before updating database values.')
  }
  const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / project.experiment.energy)
  const { project: current, opticalState } = prepareProjectOptics(project, tables, engine)
  const mode = current.sample.mode
  const result: DatabaseValues = { mode, engine: 'real', updates: [], warnings: [] }
  const primaryKind = mode === 'compound' ? 'db' : 'ff'
  const magneticKind = mode === 'compound' ? 'm' : 'ffm'
  const names = mode === 'compound' ? current.sample.layers.map(layer => layer.opticalTable)
    : current.sample.elementProfiles.map(element => element.element)
  names.forEach((name, index) => {
    const label = `${mode === 'compound' ? 'Layer' : 'Element'} ${index}: ${name || '(no table name)'}`
    const primary = tables.find(table => table.name === name && table.kind === primaryKind && name !== '')
    if (!primary?.energy.length) {
      result.warnings.push(`${label}: no ${primaryKind} table; scalar values kept.`)
      return
    }
    if (energy < primary.energy[0] || energy > primary.energy.at(-1)!) {
      result.warnings.push(`${label}: ${energy} eV is outside the ${primaryKind} table; scalar values kept.`)
      return
    }
    const magnetic = tables.find(table => table.name === name && table.kind === magneticKind && table.energy.length)
    if (!magnetic) result.warnings.push(`${label}: no ${magneticKind} table; magnetic values set to zero.`)
    else if (energy < magnetic.energy[0] || energy > magnetic.energy.at(-1)!) {
      result.warnings.push(`${label}: ${energy} eV is outside the ${magneticKind} table; magnetic values set to zero.`)
    }
  })
  if (mode === 'compound') {
    const refreshed = refreshPartialCompoundOptics(current, tables, energy, engine.lookup, opticalState.cursors, opticalState.dielectricTensors)
    refreshed.layers.forEach((layer, index) => {
      const override = refreshed.dielectricTensors[index]
      const tensor = refreshed.updated[index] ? (override ? { values: override, anisotropic: true } : engine.dielectricTensor({
        layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag,
          layer.magnetization.gamma, layer.magnetization.phi],
        tensor: current.calculation.tensorContribution === 'tetragonal' ? 1 : 0,
        magnetic: current.calculation.magnetization.mode === 'none' ? 0 : 1,
      })) : opticalState.dielectricState?.[index]
      if (!tensor) throw new Error('Missing prepared database tensor.')
      const checked = copyScriptTensors([tensor])[0]
      const stored = { values: Array.from(checked.values), anisotropic: checked.anisotropic }
      const previous = project.sample.layers[index].dielectricTensor
      const changed = stored.anisotropic !== (previous?.anisotropic ?? false) || stored.values.some((value, component) => value !== (previous?.values[component] ?? 0))
      if (refreshed.updated[index] || changed) {
        result.updates.push({ index, first: layer.delta, second: layer.beta, firstMag: layer.deltaMag, secondMag: layer.betaMag, dielectricTensor: stored })
        if (!refreshed.updated[index] && changed) result.warnings.push(`Layer ${index}: stored tensor rebuilt from scalar values during manual preparation.`)
      }
    })
  } else {
    const refreshed = refreshElementOptics(current, tables, energy, engine.lookup, request => {
      if (!engine.scatteringTensor) throw new Error('Native element scattering tensors are unavailable.')
      return engine.scatteringTensor(request)
    }, opticalState.cursors, opticalState.scatteringTensors)
    refreshed.elementProfiles.forEach((element, index) => {
      const scatteringTensor = Array.from(refreshed.scatteringTensors[index])
      const previous = project.sample.elementProfiles[index].scatteringTensor
      const changed = scatteringTensor.some((value, component) => value !== (previous?.[component] ?? 0))
      if (refreshed.updated[index] || changed) {
        result.updates.push({ index, first: element.f1, second: element.f2, firstMag: element.f1Mag, secondMag: element.f2Mag, scatteringTensor })
        if (!refreshed.updated[index] && changed) result.warnings.push(`Element ${index}: stored tensor rebuilt from scalar values during manual preparation.`)
      }
    })
  }
  // GetdbButtonClick copies BOTH arrays from the active CFilm after GetState.
  // Manual GetState rebuilds inactive tensors too; automatic mode retains them.
  const inactive: NonNullable<DatabaseValues['inactiveTensorUpdates']> = []
  if (mode === 'compound') {
    opticalState.scatteringTensors?.forEach((tensor, index) => {
      const previous = project.sample.elementProfiles[index].scatteringTensor
      if (tensor.some((value, component) => value !== (previous?.[component] ?? 0))) {
        inactive.push({ index, scatteringTensor: Array.from(tensor) })
      }
    })
  } else {
    opticalState.dielectricState?.forEach((tensor, index) => {
      if (!tensor) throw new Error('Missing inactive database tensor.')
      const previous = project.sample.layers[index].dielectricTensor
      if (tensor.anisotropic !== (previous?.anisotropic ?? false) || tensor.values.some((value, component) => value !== (previous?.values[component] ?? 0))) {
        inactive.push({ index, dielectricTensor: { values: Array.from(tensor.values), anisotropic: tensor.anisotropic } })
      }
    })
  }
  if (inactive.length) result.inactiveTensorUpdates = inactive
  return result
}
