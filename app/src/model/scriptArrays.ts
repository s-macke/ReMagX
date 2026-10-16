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

/** Mutable script workspace, isolated from the UI/project until a request succeeds. */
export function createScriptArrayWorkspace(source: Project) {
  const project = structuredClone(source)
  const arrays = new Map<string, ScriptNumericArray>()
  function register(name: string, typeId: number, count: number,
    read: (index: number) => number, write: (index: number, value: number) => void,
    requiresCompound = false) {
    function checkIndex(index: number) {
      if (requiresCompound && project.sample.mode !== 'compound') {
        throw new Error(`${name}: element-mode active-film arrays are not supported yet`)
      }
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
      (index, value) => { project.sample.layers[index][field] = value }, true)
  }
  for (const [name, field, typeId] of [['maggamma', 'gamma', 38], ['magphi', 'phi', 39]] as const) {
    register(name, typeId, project.sample.layers.length,
      index => project.sample.layers[index].magnetization[field],
      (index, value) => { project.sample.layers[index].magnetization[field] = value }, true)
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
  return {
    arrays: arrays as ReadonlyMap<string, ScriptNumericArray>,
    /** A fresh snapshot prevents callers from mutating the running script's state. */
    snapshot: (): Project => structuredClone(project),
  }
}
