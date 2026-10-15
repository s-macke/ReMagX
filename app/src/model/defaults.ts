// Default values for new projects. The default sample is the Cu/Co multilayer that the legacy
// program shipped as bin/default.all (6 × [Co 10 Å / Cu 60 Å] on Cu, 777.198 eV, Co L3 edge).

import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type Layer,
  type Polarization,
  type Project,
} from './project'

// Legacy default direction: in-plane, parallel to y.
const IN_PLANE_Y = { gamma: 90, phi: 90 }

export function createLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    material: '',
    opticalTable: '',
    density: 0,
    thickness: 0,
    roughness: 0,
    delta: 0,
    beta: 0,
    deltaMag: 0,
    betaMag: 0,
    magnetization: { ...IN_PLANE_Y },
    electronEscapeDepth: 0,
    ...overrides,
  }
}

// Beam 1 left and beam 2 right circularly polarized, as in the legacy default project.
export function createCircularPolarization(): Polarization {
  const a = Math.SQRT1_2
  return {
    beam1: { sigma: { re: a, im: 0 }, pi: { re: 0, im: a } },
    beam2: { sigma: { re: a, im: 0 }, pi: { re: 0, im: -a } },
    analyzer: false,
  }
}

const copper = (thickness: number): Layer =>
  createLayer({
    material: 'Cu',
    opticalTable: 'Cu',
    density: 8.96,
    thickness,
    roughness: 5,
    delta: 0.00165,
    beta: 0.00029911,
  })

const cobalt = (thickness: number): Layer =>
  createLayer({
    material: 'Co',
    opticalTable: 'Co',
    density: 8.9,
    thickness,
    roughness: 5,
    delta: -0.003486,
    beta: 0.0056168,
    deltaMag: 5.31087e-5,
    betaMag: -0.000132985,
    // Value as stored in the legacy default project.
    electronEscapeDepth: 5.31087e-5,
  })

const vacuum = (): Layer => createLayer({ opticalTable: 'vacuum' })

export function createDefaultProject(): Project {
  const layers: Layer[] = [copper(0)]
  for (let period = 0; period < 6; period++) {
    layers.push(cobalt(10), copper(60))
  }
  layers.push(vacuum())

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: 'Default Cu/Co multilayer',
    sample: {
      mode: 'compound',
      layers,
      elementProfiles: [],
      depthProfileFunctions: [],
      multilayer: { enabled: false, pattern: '' },
    },
    experiment: {
      energy: 777.198,
      qzScan: { qzMin: 0, qzMax: 0.6, points: 300, useDatasetPoints: false, showAngle: false },
      energyScan: { energyMin: 700, energyMax: 900, fixed: 'qz', qz: 0.1, angle: 10 },
      resolution: { angularFwhm: 0, energyFwhm: 0, fastConvolution: true },
      polarization: createCircularPolarization(),
      scattering: 'reflection',
    },
    calculation: {
      algorithm: 'parratt',
      roughnessModel: 'nevot-croce',
      segmentation: {
        minThickness: 2,
        maxThickness: 3,
        gradientScale: 1,
        tolerance: 1e-6,
        scope: 'local',
      },
      magnetization: { enabled: false, direction: { ...IN_PLANE_Y } },
      asymmetryDefinition: 'normalized',
      profileCoupling: false,
      epsilon: 5e-5,
      averaging: 0,
      postProcessing: { multiplyByQz4: false, divideByCos2ThetaSquared: false, fourierTransform: false },
      automaticOpticalConstants: false,
      useChantlerDatabase: false,
    },
    datasets: [],
    activeDatasetIndex: null,
    fit: {
      algorithm: 'simplex',
      errorFunction: 'log-chi2',
      annealing: { temperature: 1, temperatureStep: -0.01 },
      window: { qzMin: 0, qzMax: 9999, energyMin: 0, energyMax: 100000 },
      fitAngularResolution: false,
      fitIntensityScale: false,
      fitQzShift: false,
      fitEnergyShift: false,
      parameters: [],
      evolution: {
        randomSeed: 100,
        population: 5000,
        elitePercent: 1,
        parentsPercent: 40,
        mutationRangePercent: 10,
        mixingProbability: 33,
        mutationProbability: 25,
        eliteAsParents: true,
        restrictToBounds: true,
      },
    },
    scripts: { enabled: true, beforeCalculation: '', default: '', parameters: [] },
  }
}
