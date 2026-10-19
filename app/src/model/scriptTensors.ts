import type { ScriptNumericArray } from './scriptArrays'

export interface ScriptDielectricTensor {
  /** Row-major complex components, real/imaginary interleaved. */
  values: Float64Array
  anisotropic: boolean
}

export function copyScriptTensors(source: readonly ScriptDielectricTensor[]): ScriptDielectricTensor[] {
  return source.map(tensor => {
    if (tensor.values.length !== 18 || !tensor.values.every(Number.isFinite) || typeof tensor.anisotropic !== 'boolean') {
      throw new Error('Invalid script dielectric tensor')
    }
    return { values: tensor.values.slice(), anisotropic: tensor.anisotropic }
  })
}

/** Prepared active-film tensors; construction and table refresh remain engine operations. */
export function createScriptTensorWorkspace(initial: readonly ScriptDielectricTensor[]) {
  let tensors = copyScriptTensors(initial)
  const layerCount = tensors.length
  const arrays = new Map<string, ScriptNumericArray>()
  // Names and IDs follow script.cpp; ID 24 has no initialized array or valid value accessor.
  const components = ['xx', 'xy', 'xz', 'yx', 'yy', 'yz', 'zx', 'zy', 'zz'] as const
  for (const [componentIndex, component] of components.entries()) {
    for (const [part, suffix] of ['r', 'i'].entries()) {
      const name = `e${component}_${suffix}`
      const offset = 2 * componentIndex + part
      function access(index: number): ScriptDielectricTensor {
        if (!Number.isSafeInteger(index) || index < 0 || index >= layerCount) {
          throw new Error(`${name}: index out of range`)
        }
        // Legacy getelem changes epsilontype even when called by getarray.
        tensors[index].anisotropic = true
        return tensors[index]
      }
      arrays.set(name, {
        name, typeId: (part === 0 ? 15 : 25) + componentIndex, maximumIndex: layerCount - 1,
        read(index) { return access(index).values[offset] },
        write(index, value) {
          if (!Number.isFinite(value)) throw new Error(`${name}: value must be finite`)
          access(index).values[offset] = value
        },
      })
    }
  }
  return {
    arrays: arrays as ReadonlyMap<string, ScriptNumericArray>,
    replace(next: readonly ScriptDielectricTensor[]): void {
      if (next.length !== layerCount) throw new Error('Script tensor layer count changed')
      tensors = copyScriptTensors(next)
    },
    snapshot: (): ScriptDielectricTensor[] => copyScriptTensors(tensors),
    /** Existing matrix preparation consumes anisotropic tensors as explicit overrides. */
    overrides: (): (Float64Array | null)[] => tensors.map(tensor => tensor.anisotropic ? tensor.values.slice() : null),
  }
}
