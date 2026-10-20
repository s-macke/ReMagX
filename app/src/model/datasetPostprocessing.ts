import type { Dataset, Project } from './project'
import { HC_EV_ANGSTROM } from './units'

export type FourierCalculator = (qz: number[], reflectivity: number[]) => {
  depths: Float64Array; magnitudes: Float64Array
}

// CDataSet::PostModifications for already adapted coordinates/intensities.
// Preserve optional columns: asymmetry is rebuilt only if it and both beams exist.
// FFT changes only R and qz; the resulting other columns can have different lengths.
export function postprocessDatasetColumns(project: Project, input: Dataset['columns'], correctSecondBeam = true, fourier?: FourierCalculator): Dataset['columns'] {
  const { calculation, experiment } = project
  if (calculation.postProcessing.fourierTransform && !fourier) throw new Error('Fourier postprocessing is not implemented in this real-engine path yet.')
  const columns = Object.fromEntries(Object.entries(input).map(([key, values]) => [key, values ? [...values] : values])) as Dataset['columns']
  for (const values of Object.values(columns)) {
    if (values && (!values.every(Number.isFinite) || (values.length && values.length !== columns.qz.length))) {
      throw new Error('Dataset columns must be finite and aligned.')
    }
  }
  const purePi = (beam: Project['experiment']['polarization']['beam1']) =>
    beam.sigma.re === 0 && beam.sigma.im === 0 && beam.pi.re === 1 && beam.pi.im === 0
  const correctFirst = purePi(experiment.polarization.beam1)
  const correctSecond = correctSecondBeam && purePi(experiment.polarization.beam2)
  for (const name of ['reflectivity', 'reflectivityPlus', 'reflectivityMinus'] as const) {
    const values = columns[name]
    if (!values?.length) continue
    for (let index = 0; index < values.length; index++) {
      const qz = columns.qz[index]
      if (calculation.postProcessing.multiplyByQz4) values[index] *= qz * qz * qz * qz
      if (calculation.postProcessing.divideByCos2ThetaSquared && (name === 'reflectivityMinus' ? correctSecond : correctFirst)) {
        const energy = columns.energy?.length ? columns.energy[index] : experiment.energy
        const wave = 2 * Math.PI / (HC_EV_ANGSTROM / energy)
        const ratio = qz / (2 * wave)
        const angle = Math.abs(ratio) >= 1 ? -1 : Math.asin(ratio)
        values[index] /= Math.cos(2 * angle) * Math.cos(2 * angle)
      }
    }
  }
  const plus = columns.reflectivityPlus, minus = columns.reflectivityMinus
  if (plus?.length && minus?.length && columns.asymmetry?.length) {
    columns.asymmetry = plus.map((value, index) => calculation.asymmetryDefinition === 'difference'
      ? value - minus[index] : value + minus[index] !== 0 ? (value - minus[index]) / (value + minus[index]) : 0)
  }
  if (Object.values(columns).some(values => values && !values.every(Number.isFinite))) {
    throw new Error('Dataset postprocessing exceeds the supported numerical range.')
  }
  const width = calculation.averaging
  if (!Number.isSafeInteger(width) || width < 0 || width > 2147483647) throw new Error('Invalid moving-average half-width.')
  if (width) {
    for (const name of ['reflectivity', 'reflectivityPlus', 'reflectivityMinus', 'asymmetry'] as const) {
      const source = columns[name]
      if (!source?.length) continue
      columns[name] = source.map((_, index) => {
        // Legacy unsigned i makes the first windows empty. Preserve that behavior.
        if (index < width) return 0
        const start = index - width, end = Math.min(source.length - 1, index + width)
        let sum = 0
        for (let neighbor = start; neighbor <= end; neighbor++) sum += source[neighbor]
        return sum / (end - start + 1)
      })
    }
  }
  if (Object.values(columns).some(values => values && !values.every(Number.isFinite))) {
    throw new Error('Dataset postprocessing exceeds the supported numerical range.')
  }
  if (calculation.postProcessing.fourierTransform && columns.reflectivity?.length) {
    const count = Math.floor(columns.qz.length / 2)
    const result = fourier!([...columns.qz], [...columns.reflectivity])
    if (result.depths.length !== count || result.magnitudes.length !== count ||
        !result.depths.every(Number.isFinite) || !result.magnitudes.every(Number.isFinite)) {
      throw new Error('The real engine returned invalid Fourier values.')
    }
    columns.qz = Array.from(result.depths)
    columns.reflectivity = Array.from(result.magnitudes)
  }
  return columns
}
