import { prepareCompoundLayers, type PreparedCompoundLayer } from './compoundLayers'
import type { Polarization, Project } from './project'
import { HC_EV_ANGSTROM } from './units'

export interface PreparedParrattQzRequest {
  layers: PreparedCompoundLayer[]
  qz: number[]
  energy: number
  beam1: [number, number, number, number]
  beam2: [number, number, number, number] | null
  tensor: 0 | 1
  analyzer: 0 | 1 | 2
  magnetic: 0 | 1
  mode: 0 | 1
  resolution: { width: number; fast: boolean }
}

// Unit1.cpp Button3Click uses j=1..numberofpoints, not an inclusive-minimum linspace.
// Dataset points are copied and adapted as in CDataSet::Adapt, without sorting.
export function prepareQzCoordinates(project: Project): number[] {
  const scan = project.experiment.qzScan
  let coordinates: number[]
  if (scan.useDatasetPoints) {
    const dataset = project.activeDatasetIndex === null ? undefined : project.datasets[project.activeDatasetIndex]
    if (!dataset || !dataset.columns.qz.length) throw new Error('Dataset-point calculation needs an active dataset with qz coordinates.')
    const shift = Math.abs(dataset.qzShift) > 1e-10 ? dataset.qzShift : 0
    coordinates = dataset.columns.qz.map(value => value + shift)
  } else {
    if (!Number.isSafeInteger(scan.points) || scan.points < 2 || scan.points > 1000000 ||
        !Number.isFinite(scan.qzMin) || !Number.isFinite(scan.qzMax)) {
      throw new Error('A qz scan needs finite bounds and 2 to 1,000,000 points.')
    }
    // Keep LinInterpolation(0, j, count, minimum, maximum) operation order.
    coordinates = Array.from({ length: scan.points }, (_, index) =>
      scan.qzMin - (0 - (index + 1)) / (0 - scan.points) * (scan.qzMin - scan.qzMax))
  }
  if (!coordinates.every(Number.isFinite)) throw new Error('Prepared qz coordinates exceed the supported numerical range.')
  return coordinates
}

function packBeam(beam: Polarization['beam1']): [number, number, number, number] {
  return [beam.sigma.re, beam.sigma.im, beam.pi.re, beam.pi.im]
}

// Shared real-worker compound scan preparation before algorithm-specific packing.
// Requires refreshed scalar constants and rejects unimplemented preprocessing.
export function prepareCompoundQzRequest(project: Project, mode: 'monochromatic' | 'dichroic', coordinates?: readonly number[]): PreparedParrattQzRequest {
  const calculation = project.calculation
  if (project.experiment.scattering !== 'reflection') throw new Error('Transmission is not available in this real-engine path.')
  if (calculation.automaticOpticalConstants) throw new Error('Automatic optical-table refresh is not implemented in real-engine preparation yet.')
  if (project.scripts.enabled && project.scripts.beforeCalculation.trim()) throw new Error('BeforeCalculation Lua execution is not implemented in real-engine preparation yet.')
  if (calculation.postProcessing.fourierTransform) {
    throw new Error('Fourier postprocessing is not implemented in this real-engine path yet.')
  }
  const layers = prepareCompoundLayers(project)
  const qz = coordinates === undefined ? prepareQzCoordinates(project) : [...coordinates]
  if (!qz.every(Number.isFinite)) throw new Error('Prepared qz coordinates must be finite.')
  const energy = project.experiment.energy
  if (!Number.isFinite(energy) || energy <= 0) throw new Error('Calculation energy must be positive and finite.')
  // The native qz API preserves the non-fast boundary. Fast dichroic legacy scans
  // reject equality too (RechenHilfe.h CalcAsymmetrie fast-resolution branch).
  const waveNumber = 2 * Math.PI / (HC_EV_ANGSTROM / energy)
  if (mode === 'dichroic' && project.experiment.resolution.fastConvolution && qz.some(value => value / (waveNumber * 2) >= 1)) {
    throw new Error('Qz exceeds the legacy fast-dichroic scan boundary.')
  }
  const experimentResolution = project.experiment.resolution
  if (!Number.isFinite(experimentResolution.angularFwhm) || experimentResolution.angularFwhm < 0) throw new Error('Angular resolution must be finite and nonnegative.')
  const polarization = project.experiment.polarization
  return { layers, qz, energy, beam1: packBeam(polarization.beam1),
    beam2: mode === 'dichroic' ? packBeam(polarization.beam2) : null,
    tensor: calculation.tensorContribution === 'tetragonal' ? 1 : 0,
    analyzer: polarization.analyzer === 'none' ? 0 : polarization.analyzer === 'sigma' ? 1 : 2,
    magnetic: calculation.magnetization.mode === 'none' ? 0 : 1,
    mode: mode === 'monochromatic' ? 0 : 1,
    resolution: { width: experimentResolution.angularFwhm, fast: experimentResolution.fastConvolution } }
}

export function prepareParrattQzRequest(project: Project, mode: 'monochromatic' | 'dichroic', coordinates?: readonly number[]): PreparedParrattQzRequest {
  if (project.calculation.algorithm !== 'parratt') throw new Error('This real-engine path currently supports Parratt only.')
  return prepareCompoundQzRequest(project, mode, coordinates)
}
