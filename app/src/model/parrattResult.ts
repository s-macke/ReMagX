import type { Project } from './project'
import { postprocessDatasetColumns } from './datasetPostprocessing'

// CDataSet::PostModifications: normalized asymmetry is zero when the sum is zero.
export function unpackParrattResult(qz: number[], values: Float64Array, definition: Project['calculation']['asymmetryDefinition']) {
  if (values.length !== qz.length * 2 || !values.every(Number.isFinite)) throw new Error('The real engine returned invalid reflectivity values.')
  const reflectivityPlus = qz.map((_, index) => values[index * 2])
  const reflectivityMinus = qz.map((_, index) => values[index * 2 + 1])
  const asymmetry = reflectivityPlus.map((plus, index) => {
    const minus = reflectivityMinus[index]
    return definition === 'difference' ? plus - minus : plus + minus !== 0 ? (plus - minus) / (plus + minus) : 0
  })
  if (!asymmetry.every(Number.isFinite)) throw new Error('The real engine asymmetry exceeds the supported numerical range.')
  return { qz: [...qz], reflectivityPlus, reflectivityMinus, asymmetry }
}

// Preserve CDataSet::PostModifications ordering: qz^4, pure-pi correction,
// asymmetry, then independent moving averages of both beams and asymmetry.
export function postprocessParrattResult(project: Project, qz: number[], values: Float64Array, mode: 'monochromatic' | 'dichroic' = 'dichroic', scanEnergies?: number[]) {
  const { experiment } = project
  if (values.length !== qz.length * 2 || !values.every(Number.isFinite)) throw new Error('The real engine returned invalid reflectivity values.')
  const dataset = experiment.qzScan.useDatasetPoints && project.activeDatasetIndex !== null
    ? project.datasets[project.activeDatasetIndex] : undefined
  const energies = scanEnergies ?? dataset?.columns.energy
  if (energies?.length && energies.length !== qz.length) throw new Error('Dataset energy and qz columns have different lengths.')
  const shift = !scanEnergies && dataset && Math.abs(dataset.energyShift) > 1e-10 ? dataset.energyShift : 0
  const columns = postprocessDatasetColumns(project, {
    qz,
    energy: energies?.map(value => value + shift),
    reflectivityPlus: qz.map((_, index) => values[index * 2]),
    reflectivityMinus: qz.map((_, index) => values[index * 2 + 1]),
    asymmetry: qz.map(() => 0),
  }, mode === 'dichroic')
  return { qz: columns.qz, reflectivityPlus: columns.reflectivityPlus!,
    reflectivityMinus: columns.reflectivityMinus!, asymmetry: columns.asymmetry! }
}
