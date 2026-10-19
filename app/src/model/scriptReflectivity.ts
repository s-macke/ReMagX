import { postprocessDatasetColumns } from './datasetPostprocessing'
import type { ScriptSolution } from './scriptSolution'
import type { Dataset, Polarization, Project } from './project'

export interface ScriptReflectivityInput {
  columns: Dataset['columns']
  energy: number
  polarization: Polarization
}

/** Input captured by LuaCalculateReflectivity before CalcReflectivity runs hooks.
 * This API's generated grid differs from the main-window calculation grid. */
export function prepareScriptReflectivityInput(project: Project, storedEnergy: number): ScriptReflectivityInput {
  if (!Number.isFinite(storedEnergy) || storedEnergy <= 0) throw new Error('CalculateReflectivity: invalid stored energy')
  const scan = project.experiment.qzScan
  let columns: Dataset['columns']
  if (scan.useDatasetPoints) {
    const index = project.activeDatasetIndex
    if (index === null || !Number.isSafeInteger(index) || !project.datasets[index]) {
      throw new Error('CalculateReflectivity: no selected dataset')
    }
    const dataset = project.datasets[index]
    columns = structuredClone(dataset.columns)
    // CDataSet::Adapt applies significant shifts and translates before scaling.
    if (Math.abs(dataset.qzShift) > 1e-10) columns.qz = columns.qz.map(value => value + dataset.qzShift)
    if (Math.abs(dataset.energyShift) > 1e-10 && columns.energy) {
      columns.energy = columns.energy.map(value => value + dataset.energyShift)
    }
    for (const field of ['reflectivity', 'reflectivityPlus', 'reflectivityMinus', 'electronYield'] as const) {
      if (columns[field]) columns[field] = columns[field].map(value => (value + dataset.intensityOffset) * dataset.intensityScale)
    }
  } else {
    if (!Number.isSafeInteger(scan.points) || scan.points < 2 || scan.points > 1000000 || !Number.isFinite(scan.qzMax)) {
      throw new Error('CalculateReflectivity: generated grid needs 2 to 1,000,000 points and a finite maximum')
    }
    // qzMin is not used. The last point deliberately exceeds qzMax.
    columns = { qz: Array.from({ length: scan.points }, (_, index) => (index + 1) / (scan.points - 1) * scan.qzMax) }
  }
  if (Object.values(columns).some(values => values && !values.every(Number.isFinite))) {
    throw new Error('CalculateReflectivity: nonfinite adapted data')
  }
  // Dataset metadata does not override these two stored experiment settings.
  return { columns, energy: storedEnergy, polarization: structuredClone(project.experiment.polarization) }
}

/** CalcReflectivityFilm updates R, but Rp is a separate fast-resolution scratch
 * column and Rm retains imported values. PostModifications then visits all three. */
export function finishScriptReflectivityInput(project: Project, input: ScriptReflectivityInput,
  reflectivity: readonly number[], fastSamples?: readonly number[]): ScriptSolution {
  const count = input.columns.qz.length
  const valid = (values: readonly number[]) => values.length === count && Array.from(values).every(Number.isFinite)
  if (!valid(reflectivity)) throw new Error('CalculateReflectivity: invalid calculated reflectivity')
  if (project.experiment.resolution.fastConvolution && (!fastSamples || !valid(fastSamples))) {
    throw new Error('CalculateReflectivity: missing fast-resolution samples')
  }
  const previousPlus = input.columns.reflectivityPlus
  const plus = project.experiment.resolution.fastConvolution ? [...fastSamples!] :
    previousPlus?.length === count ? [...previousPlus] : Array<number>(count).fill(1)
  const metadata = { ...project, experiment: { ...project.experiment,
    energy: input.energy, polarization: input.polarization } }
  const columns = postprocessDatasetColumns(metadata, { ...input.columns,
    reflectivity: [...reflectivity], reflectivityPlus: plus })
  return { qz: columns.qz, energy: columns.energy ?? [], reflectivity: columns.reflectivity!,
    reflectivityPlus: columns.reflectivityPlus!, reflectivityMinus: columns.reflectivityMinus ?? [] }
}
