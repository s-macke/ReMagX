// Mock physics for the UI-first phase (D-33): Parratt recursion for sigma and pi polarization
// with Nevot-Croce roughness and a simple Gaussian resolution. The beam is treated as an
// incoherent mix of sigma and pi intensity. It ignores the matrix/Zak formalisms and element mode,
// and treats magnetism as delta ± deltaMag. It will be replaced by
// the WebAssembly engine ported from the legacy C++ core.

import type { Layer, Polarization, Project } from '../model/project'
import { wavelengthFromEnergy } from '../model/units'
import * as cx from './complex'
import { ComputeError, type AsymmetryCurve, type DepthProfile, type EnergyScanCurve, type ReflectivityCurve } from './ComputeService'

export interface OpticalLayer {
  delta: number
  beta: number
  thickness: number
  roughness: number // interface on top of this layer
}

export const waveNumber = (energy: number): number => (2 * Math.PI) / wavelengthFromEnergy(energy)

// Fraction of the beam intensity in sigma and pi polarization.
export interface PolarizationWeights {
  sigma: number
  pi: number
}

export const SIGMA_ONLY: PolarizationWeights = { sigma: 1, pi: 0 }

// Reflectivity of a stack (substrate first, ambient last) at the given vacuum qz values.
export function parratt(
  layers: OpticalLayer[],
  qz: number[],
  energy: number,
  polarization: PolarizationWeights = SIGMA_ONLY,
): number[] {
  const k0 = waveNumber(energy)
  return qz.map((q) => {
    const sinTheta = q / (2 * k0)
    if (sinTheta > 1) {
      throw new ComputeError(
        `qz = ${q} 1/Å corresponds to an angle above 90° at ${energy} eV. Check the qz range and the energy.`,
      )
    }
    const cos2 = 1 - sinTheta * sinTheta
    // kz_j = k0 * sqrt(n_j² - cos²θ) with n_j = 1 - delta + i*beta
    const n2 = layers.map((layer) => {
      const n = cx.c(1 - layer.delta, layer.beta)
      return cx.mul(n, n)
    })
    const kz = n2.map((nn) => {
      const kzj = cx.scale(cx.sqrt(cx.sub(nn, cx.c(cos2))), k0)
      return kzj.re === 0 && kzj.im === 0 ? cx.c(1e-100) : kzj
    })
    // Fresnel coefficient of the interface between layer j (below) and j + 1 (above).
    const fresnelSigma = (j: number) => cx.div(cx.sub(kz[j + 1], kz[j]), cx.add(kz[j + 1], kz[j]))
    const fresnelPi = (j: number) => {
      const a = cx.mul(n2[j], kz[j + 1])
      const b = cx.mul(n2[j + 1], kz[j])
      return cx.div(cx.sub(a, b), cx.add(a, b))
    }
    const recursion = (fresnel: (j: number) => cx.C) => {
      // From the substrate upwards: X_0 = 0 (no wave coming back from below).
      let x = cx.c(0)
      for (let j = 0; j < layers.length - 1; j++) {
        let r = fresnel(j)
        const sigma = layers[j].roughness
        if (sigma !== 0) r = cx.mul(r, cx.exp(cx.scale(cx.mul(kz[j + 1], kz[j]), -2 * sigma * sigma)))
        // Propagate X through layer j (the substrate, j = 0, is semi-infinite and carries X = 0).
        const phase = j === 0 ? cx.c(1) : cx.exp(cx.mul(cx.c(0, 2 * layers[j].thickness), kz[j]))
        const xp = cx.mul(x, phase)
        x = cx.div(cx.add(r, xp), cx.add(cx.c(1), cx.mul(r, xp)))
      }
      return cx.abs2(x)
    }
    const rSigma = polarization.sigma > 0 ? recursion(fresnelSigma) : 0
    const rPi = polarization.pi > 0 ? recursion(fresnelPi) : 0
    return (polarization.sigma * rSigma + polarization.pi * rPi) / (polarization.sigma + polarization.pi)
  })
}

// Intensity weights of one beam's Jones vector.
// An all-zero Jones vector falls back to pure sigma polarization.
export function beamWeights(beam: Polarization['beam1']): PolarizationWeights {
  const sigma = cx.abs2(beam.sigma)
  const pi = cx.abs2(beam.pi)
  return sigma + pi > 0 ? { sigma, pi } : SIGMA_ONLY
}

// Gaussian convolution in qz with the given FWHM (mock approximation of the angular resolution).
export function convolveResolution(
  compute: (qz: number[]) => number[],
  qz: number[],
  fwhm: number,
): number[] {
  if (fwhm <= 0) return compute(qz)
  const sigma = fwhm / (2 * Math.sqrt(2 * Math.log(2)))
  const offsets = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2].map((s) => s * sigma)
  const weights = offsets.map((o) => Math.exp(-(o * o) / (2 * sigma * sigma)))
  const weightSum = weights.reduce((a, b) => a + b, 0)
  const shifted = offsets.map((o) => compute(qz.map((q) => Math.max(q + o, 0))))
  return qz.map((_, i) => shifted.reduce((sum, curve, k) => sum + curve[i] * weights[k], 0) / weightSum)
}

export function linspace(min: number, max: number, points: number): number[] {
  if (points < 2) return [min]
  const step = (max - min) / (points - 1)
  return Array.from({ length: points }, (_, i) => min + i * step)
}

type MagneticSign = 0 | 1 | -1

function opticalLayers(layers: Layer[], magneticSign: MagneticSign = 0): OpticalLayer[] {
  return layers.map((layer) => ({
    delta: layer.delta + magneticSign * layer.deltaMag,
    beta: layer.beta + magneticSign * layer.betaMag,
    thickness: layer.thickness,
    roughness: layer.roughness,
  }))
}

function activeDataset(project: Project) {
  const i = project.activeDatasetIndex
  return i === null ? undefined : project.datasets[i]
}

// The qz grid: the active dataset's points if requested, otherwise the configured range.
export function qzGrid(project: Project): number[] {
  const scan = project.experiment.qzScan
  const dataset = activeDataset(project)
  if (scan.useDatasetPoints && dataset && dataset.columns.qz.length > 0) return [...dataset.columns.qz]
  return linspace(scan.qzMin, scan.qzMax, scan.points)
}

function checkSupported(project: Project) {
  if (project.sample.mode === 'element') {
    throw new ComputeError('Element mode is not available in the mock engine yet.')
  }
}

function reflectivityFor(
  project: Project,
  qz: number[],
  magneticSign: MagneticSign,
  beam: Polarization['beam1'],
): number[] {
  const layers = opticalLayers(project.sample.layers, magneticSign)
  const energy = project.experiment.energy
  const weights = beamWeights(beam)
  return convolveResolution((q) => parratt(layers, q, energy, weights), qz, project.experiment.resolution.angularFwhm)
}

export function calcReflectivity(project: Project): ReflectivityCurve {
  checkSupported(project)
  const qz = qzGrid(project)
  return { qz, reflectivity: reflectivityFor(project, qz, 0, project.experiment.polarization.beam1) }
}

export function calcAsymmetry(project: Project): AsymmetryCurve {
  checkSupported(project)
  const qz = qzGrid(project)
  const { beam1, beam2 } = project.experiment.polarization
  const plus = reflectivityFor(project, qz, 1, beam1)
  const minus = reflectivityFor(project, qz, -1, beam2)
  const normalized = project.calculation.asymmetryDefinition === 'normalized'
  const asymmetry = plus.map((p, i) => (normalized ? (p - minus[i]) / (p + minus[i]) : p - minus[i]))
  return { qz, reflectivityPlus: plus, reflectivityMinus: minus, asymmetry }
}

// Energy scan at fixed qz or fixed angle. Without optical-constant tables (added with the
// material library) delta and beta are taken as constant over the scan.
export function calcEnergyScan(project: Project): EnergyScanCurve {
  checkSupported(project)
  const scan = project.experiment.energyScan
  const energies = linspace(scan.energyMin, scan.energyMax, project.experiment.qzScan.points)
  const layers = opticalLayers(project.sample.layers)
  const reflectivity = energies.map((energy) => {
    const qz =
      scan.fixed === 'qz' ? scan.qz : 2 * waveNumber(energy) * Math.sin((scan.angle * Math.PI) / 180)
    return parratt(layers, [qz], energy, beamWeights(project.experiment.polarization.beam1))[0]
  })
  return { energy: energies, reflectivity }
}

// Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7), sufficient for plotting.
export function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return x >= 0 ? y : -y
}

export function depthProfile(project: Project, points = 400): DepthProfile {
  const layers = project.sample.layers
  // Interface positions: interface j sits on top of layer j; z = 0 is the substrate surface.
  const interfaces: number[] = []
  let z = 0
  for (let j = 0; j < layers.length - 1; j++) {
    if (j > 0) z += layers[j].thickness
    interfaces.push(z)
  }
  const top = z
  const margin = Math.max(20, 3 * Math.max(...layers.map((l) => l.roughness)))
  const grid = linspace(-margin, top + margin, points)

  const profile = (pick: (layer: Layer) => number) =>
    grid.map((zz) => {
      let value = pick(layers[0])
      for (let j = 0; j < interfaces.length; j++) {
        const step = pick(layers[j + 1]) - pick(layers[j])
        const sigma = layers[j].roughness
        const weight = sigma > 0 ? 0.5 * (1 + erf((zz - interfaces[j]) / (sigma * Math.SQRT2))) : zz >= interfaces[j] ? 1 : 0
        value += step * weight
      }
      return value
    })

  const values = {
    z: grid,
    delta: profile((l) => l.delta),
    beta: profile((l) => l.beta),
    deltaMag: profile((l) => l.deltaMag),
    betaMag: profile((l) => l.betaMag),
  }
  // Fixed sampling intervals illustrate the UI only, not adaptive segmentation.
  const segments = grid.slice(0, -1).map((start, index) => ({ start, end: grid[index + 1],
    delta: (values.delta[index] + values.delta[index + 1]) / 2,
    beta: (values.beta[index] + values.beta[index + 1]) / 2,
    deltaMag: (values.deltaMag[index] + values.deltaMag[index + 1]) / 2,
    betaMag: (values.betaMag[index] + values.betaMag[index + 1]) / 2,
  }))
  return { ...values, segments }
}
