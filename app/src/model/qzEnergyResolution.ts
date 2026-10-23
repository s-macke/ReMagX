import type { Project } from './project'
import type { RealBeforeCalculation, RealCurve, ScriptSessionLifetime } from './realCalculation'
import type { SerialOpticalState } from './refreshOpticalConstants'
import { prepareQzCoordinates } from './parrattRequest'
import { HC_EV_ANGSTROM } from './units'

// The active legacy quadrature, shared in value with angular_resolution.cpp.
const offsets = [-2, -1.77777777777778, -1.55555555555556, -1.33333333333333,
  -1.11111111111111, -.888888888888889, -.666666666666667, -.444444444444444,
  -.222222222222222, 0, .222222222222222, .444444444444444, .666666666666667,
  .888888888888889, 1.11111111111111, 1.33333333333333, 1.55555555555556, 1.77777777777778, 2]
const weights = [.00377799105508597, .00543307167196355, .0113273887261945,
  .0214123599246999, .0366987921471986, .0570286832606567, .0803509037851472,
  .102646753546022, .118893345923233, .124861419919597, .118893345923233,
  .102646753546022, .0803509037851472, .0570286832606567, .0366987921471986,
  .0214123599246999, .0113273887261945, .00543307167196355, .00377799105508597]

type SampleCalculation = (project: Project, previous: SerialOpticalState | undefined,
  hook: RealBeforeCalculation | undefined, coordinates: number[]) => RealCurve

export function calculateQzEnergyResolution(original: Project, previous: SerialOpticalState | undefined,
  hook: RealBeforeCalculation | undefined, lifetime: ScriptSessionLifetime, calculate: SampleCalculation): RealCurve {
  if (original.calculation.postProcessing.fourierTransform) {
    throw new Error('Energy broadening combined with Fourier processing requires review of the original mismatched array lengths.')
  }
  const qz = prepareQzCoordinates(original)
  const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / original.experiment.energy)
  const wave = 2 * Math.PI / (HC_EV_ANGSTROM / energy)
  const angles = qz.map(value => {
    const ratio = value / (2 * wave)
    if (Math.abs(ratio) >= 1) throw new Error('Qz exceeds the energy-resolution scan boundary.')
    return ratio < 0 ? 0 : Math.asin(ratio)
  })
  let current = original
  let state = previous
  let last: RealCurve | undefined
  const reflectivity = qz.map(() => 0)
  for (let index = 0; index < offsets.length; index++) {
    const sampleEnergy = energy + offsets[index] * current.experiment.resolution.energyFwhm
    const sampleWave = 2 * Math.PI / (HC_EV_ANGSTROM / sampleEnergy)
    const coordinates = angles.map(angle => 2 * sampleWave * Math.sin(angle))
    const project = { ...current, experiment: { ...current.experiment, energy: sampleEnergy } }
    // Each standalone inner call constructs a fresh CScript; fitting owns an
    // existing script and retains its globals across the nineteen samples.
    const temporary = lifetime === 'temporary' ? hook?.createTemporary?.() : undefined
    try { last = calculate(project, state, temporary?.hook ?? hook, coordinates) }
    finally { temporary?.close() }
    if (last.qz.length !== qz.length || last.reflectivityPlus.length !== qz.length) {
      throw new Error('Energy broadening requires unchanged sample array lengths.')
    }
    for (let point = 0; point < qz.length; point++) reflectivity[point] += weights[index] * last.reflectivityPlus[point]
    state = last.opticalState
    current = last.scriptedProject ?? { ...project, sample: { ...project.sample, layers: state.layers } }
  }
  if (!last || !reflectivity.every(Number.isFinite)) throw new Error('Energy broadening produced a nonfinite result.')
  return { ...last, qz, reflectivityPlus: reflectivity, finalEnergy: energy,
    scriptedProject: { ...current, experiment: { ...current.experiment, energy } } }
}
