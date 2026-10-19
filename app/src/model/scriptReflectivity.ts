import { prepareParrattQzRequest } from './parrattRequest'
import { prepareVisnovskyQzRequest } from './visnovskyRequest'
import { prepareZakQzRequest } from './zakRequest'
import type { RealCalculationEngine } from './realCalculation'
import { HC_EV_ANGSTROM } from './units'
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


/** Numerical stage after optical refresh and the nested BeforeCalculation hook.
 * Inputs/metadata were captured earlier; the post-hook project supplies physics. */
export function calculatePreparedScriptReflectivity(project: Project, input: ScriptReflectivityInput,
  engine: RealCalculationEngine, dielectricTensors?: (Float64Array | null)[]): ScriptSolution {
  const qz = input.columns.qz
  const fast = project.experiment.resolution.fastConvolution
  const local = { ...project, scripts: { ...project.scripts, enabled: false },
    calculation: { ...project.calculation, automaticOpticalConstants: false } }
  // Prepare even an empty scan so unsupported physics is never silently accepted.
  const request = project.calculation.algorithm === 'matrix'
    ? prepareVisnovskyQzRequest(local, 'monochromatic', engine.dielectricTensor, dielectricTensors, qz)
    : project.calculation.algorithm === 'zak' ? prepareZakQzRequest(local, 'monochromatic', qz)
      : prepareParrattQzRequest(local, 'monochromatic', qz)
  const calculate = (coordinates: number[], unconvolved = false) => {
    const prepared = { ...request, qz: coordinates,
      resolution: unconvolved ? { width: 0, fast: false } : request.resolution }
    const values = project.calculation.algorithm === 'matrix'
      ? engine.matrixQz(prepared as ReturnType<typeof prepareVisnovskyQzRequest>)
      : project.calculation.algorithm === 'zak' ? engine.zakQz(prepared as ReturnType<typeof prepareZakQzRequest>)
        : engine.calculate(prepared as ReturnType<typeof prepareParrattQzRequest>)
    if (values.length !== coordinates.length * 2 || !values.every(Number.isFinite)) {
      throw new Error('CalculateReflectivity: invalid native output')
    }
    return values
  }
  if (!qz.length) return finishScriptReflectivityInput(project, input, [], fast ? [] : undefined)
  if (!fast) {
    const values = calculate(qz)
    return finishScriptReflectivityInput(project, input, qz.map((_, index) => values[index * 2]))
  }
  if (!engine.convolveFastQz) throw new Error('CalculateReflectivity: native fast convolution is unavailable')
  const wave = 2 * Math.PI / (HC_EV_ANGSTROM / request.energy)
  if (qz.some(value => Math.abs(value / (2 * wave)) >= 1)) {
    throw new Error('CalculateReflectivity: qz exceeds the legacy fast calculation boundary')
  }
  const previous = input.columns.reflectivityPlus
  const samples = previous?.length === qz.length ? [...previous] : qz.map(() => 1)
  const nonnegative = qz.filter(value => value >= 0)
  if (nonnegative.length) {
    const values = calculate(nonnegative, true)
    let index = 0
    qz.forEach((value, position) => { if (value >= 0) samples[position] = values[2 * index++] })
  }
  const raw = new Float64Array(qz.length * 2)
  samples.forEach((value, index) => { raw[index * 2] = value })
  const values = engine.convolveFastQz([...qz], raw, request.resolution.width)
  if (values.length !== qz.length * 2 || !values.every(Number.isFinite)) {
    throw new Error('CalculateReflectivity: invalid native convolution output')
  }
  return finishScriptReflectivityInput(project, input, qz.map((_, index) => values[index * 2]), samples)
}
