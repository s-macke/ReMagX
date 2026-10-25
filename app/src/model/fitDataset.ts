import { datasetSchema, type Dataset, type Project } from './project'
import { postprocessDatasetColumns } from './datasetPostprocessing'

export type FitErrorMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
export interface PreparedFitDataset {
  project: Project
  measurement: Dataset['columns']
  errorMode: FitErrorMode
  scan: 'qz' | 'energy'
  beams: 'monochromatic' | 'dichroic'
  weight: number
}

// GetFitType / CalcErrorOfDataset: select by stored columns, not the visible UI mode.
export function prepareFitDataset(project: Project, index: number): PreparedFitDataset {
  if (!Number.isSafeInteger(index) || index < 0 || index >= project.datasets.length) throw new Error('Invalid fit dataset index.')
  const dataset = datasetSchema.parse(project.datasets[index])
  const source = dataset.columns
  if (!source.qz.length) throw new Error('A fit dataset needs qz coordinates.')
  const energyScan = Boolean(source.energy?.length)
  const linear = project.fit.errorFunction === 'lin-chi2'
  let errorMode: FitErrorMode
  if (source.reflectivity?.length) errorMode = energyScan ? (linear ? 5 : 4) : (linear ? 1 : 0)
  else if (source.asymmetry?.length) errorMode = energyScan ? 6 : 2
  else if (source.reflectivityPlus?.length && source.reflectivityMinus?.length) errorMode = energyScan ? 7 : 3
  else throw new Error('This dataset has no supported reflectivity, asymmetry or paired-beam fit data.')
  const local: Project = { ...project, activeDatasetIndex: index,
    experiment: { ...project.experiment, energy: dataset.energy, polarization: dataset.polarization,
      resolution: { ...project.experiment.resolution, angularFwhm: dataset.angularResolution },
      qzScan: { ...project.experiment.qzScan, useDatasetPoints: true } } }
  const columns: Dataset['columns'] = { ...source,
    qz: source.qz.map(value => Math.abs(dataset.qzShift) > 1e-10 ? value + dataset.qzShift : value),
    energy: source.energy?.map(value => Math.abs(dataset.energyShift) > 1e-10 ? value + dataset.energyShift : value) }
  for (const name of ['reflectivity', 'reflectivityPlus', 'reflectivityMinus', 'electronYield'] as const) {
    if (source[name]) columns[name] = source[name].map(value => (value + dataset.intensityOffset) * dataset.intensityScale)
  }
  // Keep local.datasets raw: existing calculation preparation applies its shifts once.
  return { project: local, measurement: postprocessDatasetColumns(local, columns, true), errorMode,
    scan: energyScan ? 'energy' : 'qz', beams: [0, 1, 4, 5].includes(errorMode) ? 'monochromatic' : 'dichroic',
    weight: dataset.errorWeight }
}
