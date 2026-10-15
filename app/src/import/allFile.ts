// Importer for legacy ReMagX state files (".all", fileversion 1). The rules follow the legacy
// loader (CStateHandler::LoadState in ReMagX 2.6) so legacy projects mean the same here:
//   - one "key = value" per line, "#" starts a comment, lines without "=" are skipped
//   - all blanks are removed from key and value; script lines keep their text (minus the first
//     blank) but are cut at "#", exactly as the legacy loader did
//   - missing keys keep the legacy defaults, not the web app's defaults
// Everything that cannot be represented is listed in the import report (spec AC-3, AC-4, D-14).

import { createLayer } from '../model/defaults'
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  fitTargetKinds,
  type Dataset,
  type DepthProfileFunction,
  type ElementProfile,
  type FitParameter,
  type Layer,
  type Polarization,
  type Project,
  validateProject,
} from '../model/project'
import { wavelengthFromEnergy } from '../model/units'

export interface ImportMessage {
  level: 'info' | 'warning'
  text: string
  line?: number
}

export interface IgnoredKey {
  key: string
  count: number
  firstLine: number
}

export interface ImportReport {
  messages: ImportMessage[]
  ignoredKeys: IgnoredKey[] // keys the legacy loader did not use either
}

export interface ImportResult {
  project: Project
  report: ImportReport
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

interface Assignment {
  key: string
  value: string // blanks removed
  text: string // value as written, first blank removed, cut at '#'
  hadComment: boolean
  line: number
}

// Splits the file into assignments with the legacy tokenizing rules.
export function parseAssignments(content: string): Assignment[] {
  const assignments: Assignment[] = []
  content.split('\n').forEach((rawLine, index) => {
    const line = rawLine.replaceAll('\r', '')
    const stop = line.search(/[#=]/)
    if (stop < 0 || line[stop] !== '=') return
    const key = line.slice(0, stop).replaceAll(' ', '')
    const rest = line.slice(stop + 1)
    const hash = rest.indexOf('#')
    const raw = hash < 0 ? rest : rest.slice(0, hash)
    assignments.push({
      key,
      value: raw.replaceAll(' ', ''),
      text: raw.startsWith(' ') ? raw.slice(1) : raw,
      hadComment: hash >= 0,
      line: index + 1,
    })
  })
  return assignments
}

const NUMBER_PREFIX = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/
const INTEGER_PREFIX = /^\s*([+-]?\d+)/

// Keys the legacy loader read but did not use, or that do not apply in the web app.
const IGNORED_BY_DESIGN: Record<string, string> = {
  layer_fitd: 'per-layer fit flags were not used by the legacy loader',
  layer_fitdelta: 'per-layer fit flags were not used by the legacy loader',
  layer_fitbeta: 'per-layer fit flags were not used by the legacy loader',
  layer_fiddelta: 'per-layer fit flags were not used by the legacy loader',
  layer_fitdbeta: 'per-layer fit flags were not used by the legacy loader',
  layer_fitsigma: 'per-layer fit flags were not used by the legacy loader',
  gauss_fit: 'fit flags were not used by the legacy loader',
  gauss_fita: 'fit flags were not used by the legacy loader',
  gauss_fitvar: 'fit flags were not used by the legacy loader',
  gauss_fitz: 'fit flags were not used by the legacy loader',
  gauss_splinepoints: 'the point count follows from the spline points',
  datasetpoints: 'the point count follows from the data',
  fit_delta: 'the legacy program derived the first fit step from the value',
  parallelization: 'the web app decides parallelization itself',
}

// Legacy fit-variable ids are indices into this list (CStateHandler.h, FitVariableType).
const LEGACY_FIT_TARGETS = fitTargetKinds

const FIT_ALGORITHMS: Record<number, Project['fit']['algorithm'] | undefined> = { 0: 'simplex', 2: 'simplex-annealing' }
const CALC_ALGORITHMS = ['parratt', 'matrix', 'zak', 'parratt-single-scattering', 'electron-yield'] as const

function legacyPolarization(): Polarization {
  return {
    beam1: { sigma: { re: 1, im: 0 }, pi: { re: 0, im: 0 } },
    beam2: { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } },
    analyzer: 'none',
  }
}

function newDataset(intensityScale: number, qzShift: number): Dataset {
  return {
    title: '',
    comment: '',
    sourceFile: '',
    energy: 10, // legacy default (avoids division by zero)
    energyShift: 0,
    angularResolution: 0,
    intensityScale,
    intensityOffset: 0,
    qzShift,
    errorWeight: 1,
    polarization: legacyPolarization(),
    active: false,
    columns: { qz: [] },
  }
}

function newProfileFunction(): DepthProfileFunction {
  return {
    deltaAmplitude: 0,
    betaAmplitude: 0,
    center: 0,
    width: 1,
    spline: { enabled: false, points: [] },
    amplitudeCoupledTo: null,
    widthCoupledTo: null,
    boundToLayer: null,
  }
}

// Project with the legacy program's built-in defaults (CStateHandler constructor), used for keys
// that a file does not contain.
function legacyBaseProject(name: string): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    sample: {
      mode: 'compound',
      layers: [createLayer(), createLayer()],
      elementProfiles: [],
      depthProfileFunctions: [],
      multilayer: { enabled: false, pattern: '' },
    },
    experiment: {
      energy: 1000,
      qzScan: { qzMin: 0, qzMax: 0.01, points: 200, useDatasetPoints: false, showAngle: false },
      energyScan: { energyMin: 0, energyMax: 0, fixed: 'qz', qz: 0, angle: 0 },
      resolution: {
        angularFwhm: 0,
        angularPoints: 9,
        fastConvolution: true,
        energyFwhm: 0,
        energyPoints: 9,
        energyFastConvolution: true,
      },
      polarization: legacyPolarization(),
      scattering: 'reflection',
    },
    calculation: {
      algorithm: 'parratt',
      roughnessModel: 'nevot-croce',
      segmentation: { minThickness: 2, maxThickness: 10, gradientScale: 1, tolerance: 1e-6, scope: 'global' },
      magnetization: { mode: 'none', direction: { gamma: 90, phi: 90 } },
      tensorContribution: 'magnetic',
      asymmetryDefinition: 'normalized',
      profileCombination: 'sum',
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
      occamQ: 0,
      annealing: { temperature: 0, temperatureStep: 0 },
      window: { qzMin: 0, qzMax: 10000, energyMin: 0, energyMax: 100000 },
      fitAngularResolution: false,
      fitIntensityScale: false,
      fitQzShift: false,
      fitEnergyShift: false,
      parameters: [],
      evolution: {
        randomSeed: 0,
        population: 500,
        elitePercent: 0,
        parentsPercent: 0,
        mutationRangePercent: 0,
        mixingProbability: 0,
        mutationProbability: 0,
        eliteAsParents: false,
        restrictToBounds: false,
      },
    },
    scripts: { enabled: true, beforeCalculation: '', default: '', parameters: [] },
  }
}

// Legacy first simplex step: 5 % of the value, else 5 % of the upper bound, else 1e-8.
function legacyFirstStep(value: number, upperBound: number): number {
  let step = Math.abs(0.05 * value)
  if (step <= 1e-7) step = Math.abs(0.05 * upperBound)
  if (step <= 1e-7) step = 1e-8
  return step
}

export function importAllFile(input: string | ArrayBuffer | Uint8Array, fileName = 'project.all'): ImportResult {
  const content =
    typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: false }).decode(input)
  const messages: ImportMessage[] = []
  const ignored = new Map<string, IgnoredKey>()
  const ignoredByDesign = new Map<string, number>()
  const info = (text: string, line?: number) => messages.push({ level: 'info', text, line })
  const warn = (text: string, line?: number) => messages.push({ level: 'warning', text, line })

  const project = legacyBaseProject(fileName.replace(/\.all$/i, ''))
  const sample = project.sample
  const experiment = project.experiment
  const calculation = project.calculation
  const fit = project.fit

  let layers: Layer[] | null = null
  let layerDefined = false // a layer_d key was seen (otherwise thickness comes from layer_z)
  const layerZ: number[] = []
  let elements: ElementProfile[] = []
  let profiles: DepthProfileFunction[] = []
  let currentProfile: DepthProfileFunction | null = null
  let splineX: number[] = []
  let splineY: number[] = []
  let fitParameters: (FitParameter & { legacyId: number; line: number })[] = []
  let datasets: Dataset[] | null = null
  let currentDataset: Dataset | null = null
  let legacyActiveIndex = 0
  let defaultScale = 1
  let defaultQzShift = 0
  let scriptLines: string[] | null = null
  let defaultScriptLines: string[] | null = null
  let scriptParameters: number[] | null = null
  let energy = 0
  let precisionLine: number | null = null

  for (const a of parseAssignments(content)) {
    const number = (fallback: number): number => {
      const match = NUMBER_PREFIX.exec(a.value)
      if (!match) {
        warn(`"${a.key}": "${a.value}" is not a number; kept ${fallback}.`, a.line)
        return fallback
      }
      return Number(match[1])
    }
    const integer = (fallback: number): number => {
      const match = INTEGER_PREFIX.exec(a.value)
      if (!match) {
        warn(`"${a.key}": "${a.value}" is not an integer; kept ${fallback}.`, a.line)
        return fallback
      }
      return Number(match[1])
    }
    const flag = (fallback: boolean): boolean => integer(fallback ? 1 : 0) !== 0
    const layer = (): Layer | undefined => {
      const last = layers?.at(-1)
      if (!last) warn(`"${a.key}" appears before any "layer" entry and was ignored.`, a.line)
      return last
    }
    const element = (): ElementProfile | undefined => {
      const last = elements.at(-1)
      if (!last) warn(`"${a.key}" appears before any "element" entry and was ignored.`, a.line)
      return last
    }
    const slab = () => {
      const last = element()?.slabs.at(-1)
      if (element() && !last) warn(`"${a.key}" appears before any "el_layer" entry and was ignored.`, a.line)
      return last
    }
    const fitParameter = () => {
      const last = fitParameters.at(-1)
      if (!last) warn(`"${a.key}" appears before any "fit_variable" entry and was ignored.`, a.line)
      return last
    }
    const dataset = (): Dataset | undefined => {
      if (!currentDataset) warn(`"${a.key}" appears before any "datasetnumber" entry and was ignored.`, a.line)
      return currentDataset ?? undefined
    }
    const pushColumn = (column: keyof Dataset['columns']) => {
      const d = dataset()
      if (!d) return
      const values = (d.columns[column] ??= [])
      values.push(number(0))
    }
    const polarizationPart = (target: Polarization, key: string) => {
      const beam = key.startsWith('ray1') ? target.beam1 : target.beam2
      const component = key.includes('sigma') ? beam.sigma : beam.pi
      if (key.endsWith('re')) component.re = number(component.re)
      else component.im = number(component.im)
    }
    const profile = () => {
      if (!currentProfile) warn(`"${a.key}" appears before any "gauss_function" entry and was ignored.`, a.line)
      return currentProfile
    }
    const finishProfile = () => {
      if (!currentProfile) return
      if (splineX.length !== splineY.length) {
        warn(`Depth-profile function ${profiles.length + 1}: ${splineX.length} spline x values but ${splineY.length} y values; extra values dropped.`)
      }
      const n = Math.min(splineX.length, splineY.length)
      currentProfile.spline.points = splineX.slice(0, n).map((z, i) => ({ z, value: splineY[i] }))
      profiles.push(currentProfile)
      currentProfile = null
      splineX = []
      splineY = []
    }
    const finishDataset = () => {
      if (!currentDataset) return
      if (currentDataset.columns.qz.length > 0) datasets?.push(currentDataset)
      else warn(`Dataset "${currentDataset.title}" has no data points and was skipped (as in legacy ReMagX).`)
      currentDataset = null
    }

    const key = a.key
    if (key in IGNORED_BY_DESIGN) {
      ignoredByDesign.set(key, (ignoredByDesign.get(key) ?? 0) + 1)
      continue
    }

    switch (key) {
      // --- versions -------------------------------------------------------------------------
      case 'fileversion':
        if (a.value !== '1') throw new ImportError(`File version "${a.value}" is not supported (only 1).`)
        break
      case 'layerversion':
        if (a.value !== '3') {
          throw new ImportError(`Layer format version ${a.value} (tabular, from early ReMagX versions) is not supported yet.`)
        }
        layers = []
        break
      case 'magneticversion':
        if (a.value !== '4') {
          throw new ImportError(`Magnetic profile format version ${a.value} (tabular) is not supported yet.`)
        }
        profiles = []
        currentProfile = null
        break
      case 'measurementdataversion':
        if (a.value !== '2') {
          throw new ImportError(`Measurement data format version ${a.value} (tabular) is not supported yet.`)
        }
        datasets = []
        break
      case 'elementlayerversion':
        elements = []
        break
      case 'fitvariableversion':
        fitParameters = []
        break

      // --- layers ---------------------------------------------------------------------------
      case 'layer':
        if (!layers) layers = []
        layers.push(createLayer())
        layerZ.push(0)
        break
      case 'layer_z':
        if (layers?.length) layerZ[layers.length - 1] = number(0)
        break
      case 'layer_d': {
        const l = layer()
        if (l) l.thickness = number(l.thickness)
        layerDefined = true
        break
      }
      case 'layer_db': {
        const l = layer()
        if (l) l.opticalTable = a.value
        break
      }
      case 'layer_material': {
        const l = layer()
        if (l) l.material = a.value
        break
      }
      case 'layer_density': {
        const l = layer()
        if (l) l.density = number(l.density)
        break
      }
      case 'layer_delta': {
        const l = layer()
        if (l) l.delta = number(l.delta)
        break
      }
      case 'layer_beta': {
        const l = layer()
        if (l) l.beta = number(l.beta)
        break
      }
      case 'layer_ddelta': {
        const l = layer()
        if (l) l.deltaMag = number(l.deltaMag)
        break
      }
      case 'layer_dbeta': {
        const l = layer()
        if (l) l.betaMag = number(l.betaMag)
        break
      }
      case 'layer_maggamma': {
        const l = layer()
        if (l) l.magnetization.gamma = number(l.magnetization.gamma)
        break
      }
      case 'layer_magphi': {
        const l = layer()
        if (l) l.magnetization.phi = number(l.magnetization.phi)
        break
      }
      case 'layer_sigma': {
        const l = layer()
        if (l) l.roughness = number(l.roughness)
        break
      }
      case 'layer_electron_escape_depth': {
        const l = layer()
        if (l) l.electronEscapeDepth = number(l.electronEscapeDepth)
        break
      }

      // --- element mode ---------------------------------------------------------------------
      case 'mode': {
        const mode = integer(0)
        if (mode !== 0 && mode !== 1) warn(`Unknown mode ${mode}; using compound mode.`, a.line)
        sample.mode = mode === 1 ? 'element' : 'compound'
        break
      }
      case 'element':
        elements.push({ element: a.value, f1: 0, f2: 0, f1Mag: 0, f2Mag: 0, slabs: [] })
        break
      case 'el_layer':
        element()?.slabs.push({ thickness: 0, density: 0, roughness: 0 })
        break
      case 'el_d': {
        const s = slab()
        if (s) s.thickness = number(s.thickness)
        break
      }
      case 'el_density': {
        const s = slab()
        if (s) s.density = number(s.density)
        break
      }
      case 'el_sigma': {
        const s = slab()
        if (s) s.roughness = number(s.roughness)
        break
      }
      case 'el_f1':
      case 'el_f2':
      case 'el_f1m':
      case 'el_f2m': {
        const e = element()
        if (!e) break
        const field = ({ el_f1: 'f1', el_f2: 'f2', el_f1m: 'f1Mag', el_f2m: 'f2Mag' } as const)[key]
        e[field] = number(e[field])
        break
      }

      // --- depth-profile (Gauss) functions --------------------------------------------------
      case 'gauss_function':
        finishProfile()
        currentProfile = newProfileFunction()
        break
      case 'gauss_delta': {
        const p = profile()
        if (p) p.deltaAmplitude = number(p.deltaAmplitude)
        break
      }
      case 'gauss_beta': {
        const p = profile()
        if (p) p.betaAmplitude = number(p.betaAmplitude)
        break
      }
      case 'gauss_variance': {
        const p = profile()
        if (p) p.width = number(p.width)
        break
      }
      case 'gauss_z': {
        const p = profile()
        if (p) p.center = number(p.center)
        break
      }
      case 'gauss_usespline': {
        const p = profile()
        if (p) p.spline.enabled = flag(false)
        break
      }
      case 'gauss_acoupling':
      case 'gauss_varcoupling':
      case 'gauss_bindtolayer': {
        const p = profile()
        if (!p) break
        const v = integer(-1)
        const target = v < 0 ? null : v
        if (key === 'gauss_acoupling') p.amplitudeCoupledTo = target
        else if (key === 'gauss_varcoupling') p.widthCoupledTo = target
        else p.boundToLayer = target
        break
      }
      case 'gauss_splinex':
        if (profile()) splineX.push(number(0))
        break
      case 'gauss_spliney':
        if (profile()) splineY.push(number(0))
        break

      // --- fit variables --------------------------------------------------------------------
      case 'fit_variable':
        fitParameters.push({
          legacyId: -1,
          line: a.line,
          target: 'thickness',
          index: null,
          elementIndex: null,
          value: 0,
          step: 0,
          lowerBound: -1e10,
          upperBound: 1e10,
        })
        break
      case 'fit_id': {
        const p = fitParameter()
        if (p) p.legacyId = integer(-1)
        break
      }
      case 'fit_additional_id': {
        const p = fitParameter()
        if (p) {
          const v = integer(-1)
          p.index = v < 0 ? null : v
        }
        break
      }
      case 'fit_element_id': {
        const p = fitParameter()
        if (p) {
          const v = integer(-1)
          p.elementIndex = v < 0 ? null : v
        }
        break
      }
      case 'fit_value': {
        const p = fitParameter()
        if (p) p.value = number(p.value)
        break
      }
      case 'fit_lower_boundary': {
        const p = fitParameter()
        if (p) p.lowerBound = number(p.lowerBound)
        break
      }
      case 'fit_upper_boundary': {
        const p = fitParameter()
        if (p) p.upperBound = number(p.upperBound)
        break
      }

      // --- datasets -------------------------------------------------------------------------
      case 'activedatasetindex':
        legacyActiveIndex = integer(0)
        break
      case 'measuremult':
        defaultScale = number(defaultScale)
        break
      case 'deltaqz':
        defaultQzShift = number(defaultQzShift)
        break
      case 'datasetnumber':
        if (!datasets) datasets = []
        finishDataset()
        currentDataset = newDataset(defaultScale, defaultQzShift)
        break
      case 'datasettitle': {
        const d = dataset()
        if (d) d.title = a.text.trim()
        break
      }
      case 'datasetcomment': {
        const d = dataset()
        if (d) d.comment = a.text.trim()
        break
      }
      case 'datasetfile': {
        const d = dataset()
        if (d) d.sourceFile = a.text.trim()
        break
      }
      case 'datasetenergy': {
        const d = dataset()
        if (d) d.energy = number(d.energy)
        break
      }
      case 'datasetlambda': {
        const d = dataset()
        if (d) d.energy = wavelengthFromEnergy(number(wavelengthFromEnergy(d.energy))) // E = hc/λ
        break
      }
      case 'datasetresolution': {
        const d = dataset()
        if (d) d.angularResolution = number(d.angularResolution)
        break
      }
      case 'datasetmultiplicator': {
        const d = dataset()
        if (d) d.intensityScale = number(d.intensityScale)
        break
      }
      case 'datasettranslator': {
        const d = dataset()
        if (d) d.intensityOffset = number(d.intensityOffset)
        break
      }
      case 'dataseterrorweight': {
        const d = dataset()
        if (d) d.errorWeight = number(d.errorWeight)
        break
      }
      case 'datasetqztranslation': {
        const d = dataset()
        if (d) d.qzShift = number(d.qzShift)
        break
      }
      case 'datasetenergyshift': {
        const d = dataset()
        if (d) d.energyShift = number(d.energyShift)
        break
      }
      case 'datasetactive': {
        const d = dataset()
        if (d) d.active = flag(false)
        break
      }
      case 'datasetray1sigmare':
      case 'datasetray1sigmaim':
      case 'datasetray1pire':
      case 'datasetray1piim':
      case 'datasetray2sigmare':
      case 'datasetray2sigmaim':
      case 'datasetray2pire':
      case 'datasetray2piim': {
        const d = dataset()
        if (d) polarizationPart(d.polarization, key.slice('dataset'.length))
        break
      }
      case 'dataset_qz':
        pushColumn('qz')
        break
      case 'dataset_R0':
        pushColumn('reflectivity')
        break
      case 'dataset_Rp':
        pushColumn('reflectivityPlus')
        break
      case 'dataset_Rm':
        pushColumn('reflectivityMinus')
        break
      case 'dataset_A':
        pushColumn('asymmetry')
        break
      case 'dataset_eng':
        pushColumn('energy')
        break
      case 'dataset_TEY':
        pushColumn('electronYield')
        break

      // --- experiment -----------------------------------------------------------------------
      case 'energy':
        energy = number(energy)
        if (energy === 0) energy = 1 // legacy guard
        break
      case 'lambda': {
        let lambda = number(0)
        if (lambda === 0) lambda = 1 // legacy guard
        energy = wavelengthFromEnergy(lambda) // E = hc/λ, same formula
        break
      }
      case 'resolution':
        experiment.resolution.angularFwhm = number(experiment.resolution.angularFwhm)
        break
      case 'energyresolution':
        experiment.resolution.energyFwhm = number(experiment.resolution.energyFwhm)
        break
      case 'fastresolution':
        experiment.resolution.fastConvolution = flag(true)
        break
      case 'qzmin':
        experiment.qzScan.qzMin = number(experiment.qzScan.qzMin)
        break
      case 'qzmax':
        experiment.qzScan.qzMax = number(experiment.qzScan.qzMax)
        break
      case 'numberofpoints': {
        const points = integer(experiment.qzScan.points)
        if (points < 2) warn(`numberofpoints = ${points} is too small; using 2.`, a.line)
        experiment.qzScan.points = Math.max(2, points)
        break
      }
      case 'usemeasurementqz':
        experiment.qzScan.useDatasetPoints = flag(false)
        break
      case 'showangle':
        experiment.qzScan.showAngle = flag(false)
        break
      case 'engscanqz':
        experiment.energyScan.qz = number(experiment.energyScan.qz)
        break
      case 'engscanangle':
        experiment.energyScan.angle = number(experiment.energyScan.angle)
        break
      case 'engscanmin':
        experiment.energyScan.energyMin = number(experiment.energyScan.energyMin)
        break
      case 'engscanmax':
        experiment.energyScan.energyMax = number(experiment.energyScan.energyMax)
        break
      case 'scattering': {
        const v = integer(0)
        if (v !== 0 && v !== 1) warn(`Unknown scattering type ${v}; using reflection.`, a.line)
        experiment.scattering = v === 1 ? 'transmission' : 'reflection'
        break
      }
      case 'ray1sigmare':
      case 'ray1sigmaim':
      case 'ray1pire':
      case 'ray1piim':
      case 'ray2sigmare':
      case 'ray2sigmaim':
      case 'ray2pire':
      case 'ray2piim':
        polarizationPart(experiment.polarization, key)
        break
      case 'pipolratio': {
        // Obsolete key: both beams elliptical with the given pi share, normalized (CPolarization).
        const ratio = number(0)
        const norm = Math.hypot(1 - ratio, ratio) || 1
        experiment.polarization.beam1 = { sigma: { re: (1 - ratio) / norm, im: 0 }, pi: { re: 0, im: ratio / norm } }
        experiment.polarization.beam2 = { sigma: { re: (1 - ratio) / norm, im: 0 }, pi: { re: 0, im: -ratio / norm } }
        break
      }
      case 'polanalyzer': {
        // 0 = pi + sigma (no analyzer), 1 = sigma, 2 = pi
        const v = integer(0)
        if (v < 0 || v > 2) warn(`Unknown analyzer setting ${v}; using none.`, a.line)
        experiment.polarization.analyzer = v === 1 ? 'sigma' : v === 2 ? 'pi' : 'none'
        break
      }

      // --- calculation ----------------------------------------------------------------------
      case 'precision':
        precisionLine = a.line
        info(`"precision = ${a.value}" ignored: the web app always computes in double precision.`, a.line)
        break
      case 'algorithm': {
        const v = integer(0)
        const algorithm = CALC_ALGORITHMS[v]
        if (!algorithm) warn(`Unknown algorithm ${v}; using Parratt.`, a.line)
        calculation.algorithm = algorithm ?? 'parratt'
        break
      }
      case 'layersegmentationmode':
        calculation.roughnessModel = integer(0) === 1 ? 'segmentation' : 'nevot-croce'
        break
      case 'calcmode': {
        // Obsolete key: 2 meant layer segmentation with magnetization profile.
        const v = integer(0)
        calculation.roughnessModel = v >= 1 ? 'segmentation' : 'nevot-croce'
        if (v === 2) calculation.magnetization.mode = 'profile'
        info('Obsolete key "calcmode" converted.', a.line)
        break
      }
      case 'fitmz':
        calculation.magnetization.mode = flag(false) ? 'profile' : 'none'
        info('Obsolete key "fitmz" converted.', a.line)
        break
      case 'magnetizationmode': {
        const v = integer(0)
        if (v < 0 || v > 2) warn(`Unknown magnetization mode ${v}; using none.`, a.line)
        calculation.magnetization.mode = v === 1 ? 'add' : v === 2 ? 'profile' : 'none'
        break
      }
      case 'maggamma':
        calculation.magnetization.direction.gamma = number(calculation.magnetization.direction.gamma)
        break
      case 'magphi':
        calculation.magnetization.direction.phi = number(calculation.magnetization.direction.phi)
        break
      case 'minlayerthickness':
        calculation.segmentation.minThickness = number(calculation.segmentation.minThickness)
        break
      case 'maxlayerthickness':
        calculation.segmentation.maxThickness = number(calculation.segmentation.maxThickness)
        break
      case 'gradientscale':
        calculation.segmentation.gradientScale = number(calculation.segmentation.gradientScale)
        break
      case 'segmentationerror':
        calculation.segmentation.tolerance = number(calculation.segmentation.tolerance)
        break
      case 'segmentationmodel':
        calculation.segmentation.scope = integer(2) === 1 ? 'local' : 'global'
        break
      case 'gausscoupling':
        calculation.profileCombination = flag(false) ? 'product' : 'sum'
        break
      case 'averaging':
        calculation.averaging = Math.max(0, integer(0))
        break
      case 'asymmetrydef':
        calculation.asymmetryDefinition = integer(0) === 1 ? 'difference' : 'normalized'
        break
      case 'ocautomatic':
        calculation.automaticOpticalConstants = flag(false)
        break
      case 'usechantlerdatabase':
        calculation.useChantlerDatabase = flag(false)
        break

      // --- fit settings ---------------------------------------------------------------------
      case 'fitalgorithm': {
        const v = integer(0)
        const algorithm = FIT_ALGORITHMS[v]
        if (v === 1) warn('Levenberg-Marquardt is not available; switched to Simplex.', a.line)
        else if (v === 3) warn('The evolutionary fit is not available yet; switched to Simplex.', a.line)
        else if (!algorithm) warn(`Unknown fit algorithm ${v}; switched to Simplex.`, a.line)
        fit.algorithm = algorithm ?? 'simplex'
        break
      }
      case 'fiterrorfunction': {
        const v = integer(0)
        if (v !== 0 && v !== 1) warn(`Unknown fit error function ${v}; using log chi².`, a.line)
        fit.errorFunction = v === 1 ? 'lin-chi2' : 'log-chi2'
        break
      }
      case 'fittemp':
        fit.annealing.temperature = number(fit.annealing.temperature)
        break
      case 'fitdtemp':
        fit.annealing.temperatureStep = number(fit.annealing.temperatureStep)
        break
      case 'fitqzmin':
        fit.window.qzMin = number(fit.window.qzMin)
        break
      case 'fitqzmax':
        fit.window.qzMax = number(fit.window.qzMax)
        break
      case 'fitenergymin':
        fit.window.energyMin = number(fit.window.energyMin)
        break
      case 'fitenergymax':
        fit.window.energyMax = number(fit.window.energyMax)
        break
      case 'fitresolution':
        fit.fitAngularResolution = flag(false)
        break
      case 'fitmeasmult':
        fit.fitIntensityScale = flag(false)
        break
      case 'fitdeltaqz':
        fit.fitQzShift = flag(false)
        break
      case 'fitenergyshift':
        fit.fitEnergyShift = flag(false)
        break
      case 'evo_random':
        fit.evolution.randomSeed = integer(fit.evolution.randomSeed)
        break
      case 'evo_population':
        fit.evolution.population = Math.max(1, integer(fit.evolution.population))
        break
      case 'evo_elite':
        fit.evolution.elitePercent = number(fit.evolution.elitePercent)
        break
      case 'evo_parents':
        fit.evolution.parentsPercent = number(fit.evolution.parentsPercent)
        break
      case 'evo_range':
        fit.evolution.mutationRangePercent = number(fit.evolution.mutationRangePercent)
        break
      case 'evo_mixing':
        fit.evolution.mixingProbability = number(fit.evolution.mixingProbability)
        break
      case 'evo_probability':
        fit.evolution.mutationProbability = number(fit.evolution.mutationProbability)
        break
      case 'evo_takeeliteasparents':
        fit.evolution.eliteAsParents = flag(false)
        break
      case 'evo_evorestrictfitparameters':
        fit.evolution.restrictToBounds = flag(false)
        break

      // --- scripts and multilayer -----------------------------------------------------------
      case 'disablescript':
        project.scripts.enabled = !flag(false)
        break
      case 'scriptparameters':
        ;(scriptParameters ??= []).push(number(0))
        break
      case 'scriptline':
      case 'defaultscriptline':
        if (a.hadComment) {
          warn(`Script line ${a.line}: text after "#" was dropped, as the legacy program did.`, a.line)
        }
        if (key === 'scriptline') (scriptLines ??= []).push(a.text)
        else (defaultScriptLines ??= []).push(a.text)
        break
      case 'enablemultilayer':
        sample.multilayer.enabled = flag(false)
        break
      case 'multilayerscript':
        sample.multilayer.pattern = a.text
        break

      default: {
        const entry = ignored.get(key)
        if (entry) entry.count++
        else ignored.set(key, { key, count: 1, firstLine: a.line })
      }
    }

  }

  // --- finish open sections (legacy pushes the last open entries at the end) -----------------
  if (currentProfile) {
    const profile = currentProfile as DepthProfileFunction
    const n = Math.min(splineX.length, splineY.length)
    if (splineX.length !== splineY.length) {
      warn(`Depth-profile function ${profiles.length + 1}: spline x and y counts differ; extra values dropped.`)
    }
    profile.spline.points = splineX.slice(0, n).map((z, i) => ({ z, value: splineY[i] }))
    profiles.push(profile)
  }
  if (currentDataset) {
    const last = currentDataset as Dataset
    if (last.columns.qz.length > 0) datasets?.push(last)
    else warn(`Dataset "${last.title}" has no data points and was skipped (as in legacy ReMagX).`)
  }

  // Layers: legacy derives thicknesses from z positions if no layer_d was stored.
  if (layers) {
    if (!layerDefined && layers.length > 2) {
      for (let i = 1; i < layers.length - 1; i++) layers[i].thickness = layerZ[i] - layerZ[i - 1]
      info('Layer thicknesses were derived from the stored z positions.')
    }
    if (layers.length < 2) {
      warn(`The file defines ${layers.length} layer(s); substrate and ambient layers were added.`)
      while (layers.length < 2) layers.push(createLayer())
    }
    sample.layers = layers
  }
  sample.elementProfiles = elements
  sample.depthProfileFunctions = profiles

  // Datasets: legacy index 0 is an empty placeholder, so legacy index k is our index k - 1.
  for (const d of datasets ?? []) {
    const n = d.columns.qz.length
    for (const [name, column] of Object.entries(d.columns) as [keyof Dataset['columns'], number[] | undefined][]) {
      if (name === 'qz' || !column || column.length === n) continue
      warn(`Dataset "${d.title}": column "${name}" has ${column.length} values but qz has ${n}; the column was dropped.`)
      delete d.columns[name]
    }
  }
  project.datasets = datasets ?? []
  project.activeDatasetIndex =
    legacyActiveIndex >= 1 && legacyActiveIndex <= project.datasets.length ? legacyActiveIndex - 1 : null

  if (energy > 0) experiment.energy = energy
  else warn(`The file contains no energy; using ${experiment.energy} eV.`)

  fit.parameters = fitParameters.flatMap(({ legacyId, line, ...parameter }) => {
    const target = LEGACY_FIT_TARGETS[legacyId]
    if (!target) {
      warn(`Fit variable with unknown id ${legacyId} was skipped.`, line)
      return []
    }
    return [{ ...parameter, target, step: legacyFirstStep(parameter.value, parameter.upperBound) }]
  })

  if (scriptLines) project.scripts.beforeCalculation = scriptLines.join('\n')
  if (defaultScriptLines) project.scripts.default = defaultScriptLines.join('\n')
  if (scriptParameters) project.scripts.parameters = scriptParameters

  for (const [key, count] of ignoredByDesign) {
    info(`"${key}" ignored${count > 1 ? ` (${count}×)` : ''}: ${IGNORED_BY_DESIGN[key]}.`)
  }
  if (precisionLine === null) info('Computed in double precision.')
  const ignoredKeys = [...ignored.values()]
  if (ignoredKeys.length > 0) {
    info(`${ignoredKeys.length} key(s) not used by legacy ReMagX 2.6 were ignored: ${ignoredKeys.map((k) => k.key).join(', ')}.`)
  }

  const validation = validateProject(project)
  if (!validation.ok) {
    throw new ImportError(`The imported project is invalid:\n${validation.issues.join('\n')}`)
  }
  return { project: validation.project, report: { messages, ignoredKeys } }
}
