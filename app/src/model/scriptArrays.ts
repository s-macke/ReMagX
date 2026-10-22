import { HC_EV_ANGSTROM } from './units'
import type { ScriptHookState } from './scriptHookState'
import type { Project } from './project'

// User-visible names/type IDs from script.cpp and scriptmetaarray.cpp.
const layerFields = {
  delta: ['delta', 0], beta: ['beta', 1], sigma: ['roughness', 2],
  thickness: ['thickness', 3], deltam: ['deltaMag', 4], betam: ['betaMag', 5],
  density: ['density', 37],
} as const
const profileFields = {
  gauss_delta: ['deltaAmplitude', 11], gauss_beta: ['betaAmplitude', 12],
  gauss_variance: ['width', 13], gauss_z: ['center', 14],
} as const

export interface ScriptNumericArray {
  readonly name: string
  readonly typeId: number
  /** Legacy array.size returns the highest index, including -1 for an empty array. */
  readonly maximumIndex: number
  read(index: number): number
  write(index: number, value: number): void
}

export type ScriptFactorField = 'f1' | 'f2' | 'f1Mag' | 'f2Mag'
export type ScriptSlabField = 'thickness' | 'roughness' | 'density'
export interface ScriptElementBinding {
  name: string
  getFactor(field: ScriptFactorField): number
  setFactor(field: ScriptFactorField, value: number): void
  getSlab(index: number, field: ScriptSlabField): number
  setSlab(index: number, field: ScriptSlabField, value: number): void
}

/** Mutable script workspace, isolated from the UI/project until a request succeeds. */
export function createScriptArrayWorkspace(source: Project) {
  const project = cloneScriptProject(source)
  let wavelength = HC_EV_ANGSTROM / project.experiment.energy
  let renewOpticalConstants = 0
  const arrays = new Map<string, ScriptNumericArray>()
  function register(name: string, typeId: number, count: number,
    read: (index: number) => number, write: (index: number, value: number) => void) {
    function checkIndex(index: number) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
        throw new Error(`${name}: index out of range`)
      }
    }
    arrays.set(name, {
      name, typeId, maximumIndex: count - 1,
      read(index) { checkIndex(index); return read(index) },
      write(index, value) {
        checkIndex(index)
        if (!Number.isFinite(value)) throw new Error(`${name}: value must be finite`)
        // Do not clamp: scripts may use temporary signed values before completing.
        write(index, value)
      },
    })
  }
  for (const [name, [field, typeId]] of Object.entries(layerFields)) {
    register(name, typeId, project.sample.layers.length,
      index => project.sample.layers[index][field],
      (index, value) => { project.sample.layers[index][field] = value })
  }
  for (const [name, field, typeId] of [['maggamma', 'gamma', 38], ['magphi', 'phi', 39]] as const) {
    register(name, typeId, project.sample.layers.length,
      index => project.sample.layers[index].magnetization[field],
      (index, value) => { project.sample.layers[index].magnetization[field] = value })
  }
  for (const [name, [field, typeId]] of Object.entries(profileFields)) {
    register(name, typeId, project.sample.depthProfileFunctions.length,
      index => project.sample.depthProfileFunctions[index][field],
      (index, value) => { project.sample.depthProfileFunctions[index][field] = value })
  }
  register('par', 34, project.scripts.parameters.length,
    index => project.scripts.parameters[index],
    (index, value) => { project.scripts.parameters[index] = value })
  for (const [name, typeId] of [['f1', 35], ['f2', 36]] as const) {
    register(name, typeId, project.sample.elementProfiles.length,
      index => project.sample.elementProfiles[index][name],
      (index, value) => { project.sample.elementProfiles[index][name] = value })
  }
  const elements: ScriptElementBinding[] = project.sample.elementProfiles.map((initialProfile, elementIndex) => {
    const current = () => project.sample.elementProfiles[elementIndex]
    function slab(index: number) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= current().slabs.length) {
        throw new Error(`${initialProfile.element}: slab index out of range`)
      }
      return current().slabs[index]
    }
    function finite(value: number) {
      if (!Number.isFinite(value)) throw new Error(`${initialProfile.element}: value must be finite`)
    }
    return {
      name: initialProfile.element,
      getFactor: field => current()[field],
      setFactor(field, value) { finite(value); current()[field] = value },
      getSlab: (index, field) => slab(index)[field],
      setSlab(index, field, value) { finite(value); slab(index)[field] = value },
    }
  })
  return {
    replace(next: Project, renew = 0): void {
      const previous = project.sample, sample = next.sample
      if (sample.mode !== previous.mode || sample.layers.length !== previous.layers.length ||
        sample.depthProfileFunctions.length !== previous.depthProfileFunctions.length ||
        sample.elementProfiles.length !== previous.elementProfiles.length ||
        next.scripts.parameters.length !== project.scripts.parameters.length ||
        sample.elementProfiles.some((element, index) => element.element !== previous.elementProfiles[index].element ||
          element.slabs.length !== previous.elementProfiles[index].slabs.length)) {
        throw new Error('Script project structure changed; create a new session')
      }
      const nextWavelength = next.experiment.energy === project.experiment.energy ? wavelength : HC_EV_ANGSTROM / next.experiment.energy
      if (!(nextWavelength > 0) || !Number.isFinite(nextWavelength) || !Number.isFinite(renew)) {
        throw new Error('Invalid script project refresh')
      }
      const copy = cloneScriptProject(next)
      Object.assign(project, copy)
      wavelength = nextWavelength
      renewOpticalConstants = renew
    },
    calculationEnergy: (): number => HC_EV_ANGSTROM / wavelength,
    beginHook(): ScriptHookState {
      const state = { energy: HC_EV_ANGSTROM / wavelength, epsilon: project.calculation.epsilon,
        resolution: project.experiment.resolution.angularFwhm, energyScanQz: project.experiment.energyScan.qz,
        renewOpticalConstants }
      // Consume before executing, so nested calculations see the cleared state.
      renewOpticalConstants = 0
      return state
    },
    applyHook(state: ScriptHookState): void {
      const nextWavelength = HC_EV_ANGSTROM / state.energy
      if (![state.energy, state.epsilon, state.resolution, state.energyScanQz].every(Number.isFinite) ||
        !(nextWavelength > 0) || !Number.isFinite(nextWavelength)) throw new Error('Invalid script result state')
      wavelength = nextWavelength
      project.experiment.energy = HC_EV_ANGSTROM / wavelength
      project.calculation.epsilon = state.epsilon
      project.experiment.resolution.angularFwhm = state.resolution
      project.experiment.energyScan.qz = state.energyScanQz
    },
    setLayerText(index: number, field: 'material' | 'opticalTable', value: string): void {
      if (!Number.isSafeInteger(index) || index < 0 || index >= project.sample.layers.length) {
        throw new Error('Layer index out of range')
      }
      project.sample.layers[index][field] = value
    },
    elements,
    arrays: arrays as ReadonlyMap<string, ScriptNumericArray>,
    /** A fresh snapshot prevents callers from mutating the running script's state. */
    snapshot: (): Project => cloneScriptProject(project),
  }
}


// Project is a schema-defined graph of plain records, arrays and primitives.
// Copy measurement arrays in bulk, then copy the small records directly rather
// than serializing every dataset's metadata at every script invocation. One map
// retains shared references within a snapshot, never across snapshots.
function cloneScriptProject(source: Project): Project {
  const copies = new Map<object, object>()
  for (const dataset of source.datasets) {
    for (const values of Object.values(dataset.columns)) {
      if (values !== undefined && !copies.has(values)) copies.set(values, values.slice())
    }
  }
  function copy(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value
    const previous = copies.get(value)
    if (previous) return previous
    if (Array.isArray(value)) {
      const result: unknown[] = new Array(value.length)
      copies.set(value, result)
      value.forEach((entry, index) => { result[index] = copy(entry) })
      return result
    }
    const result: Record<string, unknown> = {}
    copies.set(value, result)
    for (const [key, entry] of Object.entries(value)) {
      // Keep own data properties even for names with special object setters.
      if (key === '__proto__') Object.defineProperty(result, key, {
        value: copy(entry), enumerable: true, configurable: true, writable: true,
      })
      else result[key] = copy(entry)
    }
    return result
  }
  return copy(source) as Project
}
