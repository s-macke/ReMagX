// Project model of the ReMagX web app: the versioned JSON document that is saved, loaded,
// autosaved and sent to the compute worker (spec §4, decisions D-8).
//
// Units: lengths in Ångström, energies in eV, qz in 1/Å, angles in degrees.
// All numbers are IEEE-754 doubles (D-3 / F-3: double precision only).

import { z } from 'zod'

export const PROJECT_FORMAT = 'remagx-project'
export const PROJECT_VERSION = 1

const finite = z.number().refine(Number.isFinite, 'must be a finite number')
const nonNegative = finite.refine((v) => v >= 0, 'must be >= 0')
const index = z.number().int().nonnegative()

export const complexSchema = z.object({ re: finite, im: finite })

// Jones vector of one incoming beam, split into sigma and pi components.
export const beamPolarizationSchema = z.object({
  sigma: complexSchema,
  pi: complexSchema,
})

export const polarizationSchema = z.object({
  beam1: beamPolarizationSchema,
  beam2: beamPolarizationSchema,
  analyzer: z.boolean(),
})

// Direction of the magnetization: gamma is the polar angle from the surface normal,
// phi the azimuth in the surface plane (legacy default 90°/90° = in-plane along y).
export const magnetizationDirectionSchema = z.object({
  gamma: finite,
  phi: finite,
})

// One layer in compound mode. Optical constants follow n = 1 - delta + i*beta; the magnetic
// parts deltaMag/betaMag are the dichroic contributions.
export const layerSchema = z.object({
  material: z.string(),
  opticalTable: z.string(), // name of the optical-constant table (legacy ".db" file), may be empty
  density: nonNegative, // g/cm³
  thickness: nonNegative,
  roughness: nonNegative, // rms roughness sigma of the interface on top of this layer
  delta: finite,
  beta: finite,
  deltaMag: finite,
  betaMag: finite,
  magnetization: magnetizationDirectionSchema,
  electronEscapeDepth: nonNegative,
})

// Element mode: per chemical element a stack of slabs with a density profile.
export const elementSlabSchema = z.object({
  thickness: nonNegative,
  density: nonNegative,
  roughness: nonNegative,
})

export const elementProfileSchema = z.object({
  element: z.string(),
  f1: finite,
  f2: finite,
  f1Mag: finite,
  f2Mag: finite,
  slabs: z.array(elementSlabSchema),
})

// Additional depth profile (legacy "Gauss functions"): a Gaussian or spline-shaped
// contribution to delta/beta. Coupling indices refer to other entries of the same list.
export const depthProfileFunctionSchema = z.object({
  deltaAmplitude: finite,
  betaAmplitude: finite,
  center: finite, // z position
  width: nonNegative, // standard deviation of the Gaussian
  spline: z.object({
    enabled: z.boolean(),
    points: z.array(z.object({ z: finite, value: finite })),
  }),
  amplitudeCoupledTo: index.nullable(),
  widthCoupledTo: index.nullable(),
  boundToLayer: index.nullable(),
})

export const sampleSchema = z.object({
  mode: z.enum(['compound', 'element']),
  // layers[0] is the substrate, the last entry the ambient medium (usually vacuum). This is the
  // order of the legacy program and of the Parratt recursion; the UI shows it reversed.
  layers: z.array(layerSchema).min(2),
  elementProfiles: z.array(elementProfileSchema),
  depthProfileFunctions: z.array(depthProfileFunctionSchema),
  multilayer: z.object({
    enabled: z.boolean(),
    pattern: z.string(), // e.g. "0, 3*(1, 2), 4"
  }),
})

export const experimentSchema = z.object({
  energy: finite.refine((v) => v > 0, 'must be > 0'),
  qzScan: z.object({
    qzMin: nonNegative,
    qzMax: nonNegative,
    points: z.number().int().min(2),
    useDatasetPoints: z.boolean(),
    showAngle: z.boolean(), // x axis in degrees instead of qz
  }),
  energyScan: z.object({
    energyMin: nonNegative,
    energyMax: nonNegative,
    fixed: z.enum(['qz', 'angle']),
    qz: nonNegative,
    angle: nonNegative,
  }),
  resolution: z.object({
    angularFwhm: nonNegative,
    energyFwhm: nonNegative,
    fastConvolution: z.boolean(),
  }),
  polarization: polarizationSchema,
  scattering: z.enum(['reflection', 'transmission']),
})

export const calculationSchema = z.object({
  algorithm: z.enum(['parratt', 'matrix', 'zak', 'parratt-single-scattering', 'electron-yield']),
  roughnessModel: z.enum(['nevot-croce', 'segmentation']),
  segmentation: z.object({
    minThickness: nonNegative,
    maxThickness: nonNegative,
    gradientScale: finite,
    tolerance: nonNegative,
    scope: z.enum(['local', 'global']),
  }),
  magnetization: z.object({
    enabled: z.boolean(),
    direction: magnetizationDirectionSchema,
  }),
  asymmetryDefinition: z.enum(['normalized', 'difference']), // (R1-R2)/(R1+R2) or R1-R2
  profileCoupling: z.boolean(), // legacy "gausscoupling": couple depth-profile functions
  epsilon: finite,
  averaging: z.number().int().nonnegative(),
  postProcessing: z.object({
    multiplyByQz4: z.boolean(),
    divideByCos2ThetaSquared: z.boolean(),
    fourierTransform: z.boolean(),
  }),
  automaticOpticalConstants: z.boolean(),
  useChantlerDatabase: z.boolean(),
})

// Measured data, column-oriented. qz is used for reflectivity scans, energy for energy scans.
export const datasetSchema = z
  .object({
    title: z.string(),
    comment: z.string(),
    sourceFile: z.string(),
    energy: finite,
    energyShift: finite,
    angularResolution: nonNegative,
    intensityScale: finite,
    intensityOffset: finite, // added to the reflectivity before scaling: (R + offset) * scale
    qzShift: finite,
    errorWeight: finite,
    polarization: polarizationSchema,
    active: z.boolean(), // included in fits
    columns: z.object({
      qz: z.array(finite),
      energy: z.array(finite).optional(),
      reflectivity: z.array(finite).optional(),
      reflectivityPlus: z.array(finite).optional(),
      reflectivityMinus: z.array(finite).optional(),
      asymmetry: z.array(finite).optional(),
      electronYield: z.array(finite).optional(),
    }),
  })
  .superRefine((dataset, ctx) => {
    const n = dataset.columns.qz.length
    for (const [name, column] of Object.entries(dataset.columns)) {
      if (column && column.length !== n) {
        ctx.addIssue({
          code: 'custom',
          path: ['columns', name],
          message: `column has ${column.length} values, qz has ${n}`,
        })
      }
    }
  })

export const fitTargetKinds = [
  'thickness',
  'delta',
  'beta',
  'roughness',
  'deltaMag',
  'betaMag',
  'angularResolution',
  'intensityScale',
  'qzShift',
  'profileDeltaAmplitude',
  'profileBetaAmplitude',
  'profileWidth',
  'profileCenter',
  'scriptParameter',
  'elementDensity',
  'elementThickness',
  'elementRoughness',
  'betaKramersKronig',
  'deltaKramersKronig',
  'elementF1',
  'elementF2',
  'elementF1Mag',
  'elementF2Mag',
  'electronEscapeDepth',
  'electronGain',
  'energyShift',
  'magnetizationGamma',
  'magnetizationPhi',
] as const

export const fitParameterSchema = z.object({
  target: z.enum(fitTargetKinds),
  index: index.nullable(), // layer, profile function, slab or script-parameter index
  elementIndex: index.nullable(), // element profile, element mode only
  value: finite,
  step: finite, // initial simplex step
  lowerBound: finite,
  upperBound: finite,
})

export const evolutionSettingsSchema = z.object({
  randomSeed: z.number().int(),
  population: z.number().int().positive(),
  elitePercent: finite,
  parentsPercent: finite,
  mutationRangePercent: finite,
  mixingProbability: finite,
  mutationProbability: finite,
  eliteAsParents: z.boolean(),
  restrictToBounds: z.boolean(),
})

export const fitSchema = z.object({
  algorithm: z.enum(['simplex', 'simplex-annealing']),
  errorFunction: z.enum(['log-chi2', 'lin-chi2']),
  annealing: z.object({ temperature: finite, temperatureStep: finite }),
  window: z.object({
    qzMin: finite,
    qzMax: finite,
    energyMin: finite,
    energyMax: finite,
  }),
  fitAngularResolution: z.boolean(),
  fitIntensityScale: z.boolean(),
  fitQzShift: z.boolean(),
  fitEnergyShift: z.boolean(),
  parameters: z.array(fitParameterSchema),
  // Kept from legacy projects for later; not used by the MVP (D-25, D-27).
  evolution: evolutionSettingsSchema,
})

export const scriptsSchema = z.object({
  enabled: z.boolean(),
  beforeCalculation: z.string(),
  default: z.string(),
  parameters: z.array(finite),
})

export const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  name: z.string(),
  sample: sampleSchema,
  experiment: experimentSchema,
  calculation: calculationSchema,
  datasets: z.array(datasetSchema),
  activeDatasetIndex: index.nullable(),
  fit: fitSchema,
  scripts: scriptsSchema,
})

export type Complex = z.infer<typeof complexSchema>
export type Polarization = z.infer<typeof polarizationSchema>
export type Layer = z.infer<typeof layerSchema>
export type ElementProfile = z.infer<typeof elementProfileSchema>
export type DepthProfileFunction = z.infer<typeof depthProfileFunctionSchema>
export type Sample = z.infer<typeof sampleSchema>
export type Experiment = z.infer<typeof experimentSchema>
export type Calculation = z.infer<typeof calculationSchema>
export type Dataset = z.infer<typeof datasetSchema>
export type FitTargetKind = (typeof fitTargetKinds)[number]
export type FitParameter = z.infer<typeof fitParameterSchema>
export type FitSettings = z.infer<typeof fitSchema>
export type Scripts = z.infer<typeof scriptsSchema>
export type Project = z.infer<typeof projectSchema>

export type ValidationResult =
  | { ok: true; project: Project }
  | { ok: false; issues: string[] }

// Validates untrusted input (a loaded file, an autosave) and returns readable issues.
export function validateProject(input: unknown): ValidationResult {
  const result = projectSchema.safeParse(input)
  if (result.success) return { ok: true, project: result.data }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  }
}
