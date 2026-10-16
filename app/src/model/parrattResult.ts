import type { Project } from './project'
import { HC_EV_ANGSTROM } from './units'

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
  const { calculation, experiment } = project
  if (calculation.postProcessing.fourierTransform) throw new Error('Fourier postprocessing is not implemented in the real engine yet.')
  if (values.length !== qz.length * 2 || !values.every(Number.isFinite)) throw new Error('The real engine returned invalid reflectivity values.')
  const adjusted = values.slice()
  const dataset = experiment.qzScan.useDatasetPoints && project.activeDatasetIndex !== null
    ? project.datasets[project.activeDatasetIndex] : undefined
  const energies = scanEnergies ?? dataset?.columns.energy
  if (energies?.length && energies.length !== qz.length) throw new Error('Dataset energy and qz columns have different lengths.')
  const shift = !scanEnergies && dataset && Math.abs(dataset.energyShift) > 1e-10 ? dataset.energyShift : 0
  const isPurePi = (beam: Project['experiment']['polarization']['beam1']) =>
    beam.sigma.re === 0 && beam.sigma.im === 0 && beam.pi.re === 1 && beam.pi.im === 0
  const correct = [isPurePi(experiment.polarization.beam1), mode === 'dichroic' && isPurePi(experiment.polarization.beam2)]
  for (let index = 0; index < qz.length; index++) {
    if (calculation.postProcessing.multiplyByQz4) {
      const factor = qz[index] * qz[index] * qz[index] * qz[index]
      adjusted[index * 2] *= factor
      adjusted[index * 2 + 1] *= factor
    }
    if (calculation.postProcessing.divideByCos2ThetaSquared) {
      const energy = energies?.length ? energies[index] + shift : experiment.energy
      const wave = 2 * Math.PI / (HC_EV_ANGSTROM / energy)
      const ratio = qz[index] / (2 * wave)
      // CDataSet::ToTheta returns -1 (not an error) at abs(ratio)>=1.
      const angle = Math.abs(ratio) >= 1 ? -1 : Math.asin(ratio)
      const divisor = Math.cos(2 * angle) * Math.cos(2 * angle)
      for (let beam = 0; beam < 2; beam++) if (correct[beam]) adjusted[index * 2 + beam] /= divisor
    }
  }
  const result = unpackParrattResult(qz, adjusted, calculation.asymmetryDefinition)
  const width = calculation.averaging
  if (!Number.isSafeInteger(width) || width < 0 || width > 2147483647) throw new Error('Invalid moving-average half-width.')
  if (width) {
    // Re-sum each original window left to right, retaining legacy double rounding.
    const average = (source: number[]) => source.map((_, index) => {
      // Legacy unsigned i makes j <= i+width false when the initial j is negative.
      // Preserve the resulting leading zeros; correcting this needs D-29 approval.
      if (index < width) return 0
      const start = index - width
      const end = Math.min(source.length - 1, index + width)
      let sum = 0
      for (let neighbor = start; neighbor <= end; neighbor++) sum += source[neighbor]
      return sum / (end - start + 1)
    })
    result.reflectivityPlus = average(result.reflectivityPlus)
    result.reflectivityMinus = average(result.reflectivityMinus)
    result.asymmetry = average(result.asymmetry)
  }
  if (!result.reflectivityPlus.every(Number.isFinite) || !result.reflectivityMinus.every(Number.isFinite) || !result.asymmetry.every(Number.isFinite)) {
    throw new Error('Reflectivity postprocessing exceeds the supported numerical range.')
  }
  return result
}
