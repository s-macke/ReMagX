import type { ScriptNumericArray } from './scriptArrays'

export interface ScriptSolution {
  qz: number[]
  reflectivity: number[]
  reflectivityPlus: number[]
  reflectivityMinus: number[]
  energy: number[]
}

/** CScript::data is replaced by calculations; userdata keeps referencing that slot. */
export function createScriptSolutionWorkspace() {
  let solution: ScriptSolution = { qz: [], reflectivity: [], reflectivityPlus: [], reflectivityMinus: [], energy: [] }
  const fields = [
    ['solution_qz', 'qz', 6], ['solution_R', 'reflectivity', 7],
    ['solution_Rp', 'reflectivityPlus', 8], ['solution_Rm', 'reflectivityMinus', 9],
    ['solution_energy', 'energy', 10],
  ] as const
  const arrays = new Map<string, ScriptNumericArray>()
  for (const [name, field, typeId] of fields) {
    function check(index: number) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= solution[field].length) {
        throw new Error(`${name}: index out of range`)
      }
    }
    arrays.set(name, {
      name, typeId, maximumIndex: -1,
      read(index) { check(index); return solution[field][index] },
      write(index, value) {
        check(index)
        if (!Number.isFinite(value)) throw new Error(`${name}: value must be finite`)
        solution[field][index] = value
      },
    })
  }
  return {
    arrays: arrays as ReadonlyMap<string, ScriptNumericArray>,
    // Legacy getelem uses qz length for every handle whose declared size is -1.
    dynamicMaximumIndex: () => solution.qz.length - 1,
    replace(next: ScriptSolution): void {
      const copy = structuredClone(next)
      for (const [, field] of fields) {
        if (!Array.isArray(copy[field]) || !Array.from(copy[field]).every(Number.isFinite)) {
          throw new Error(`Invalid script solution column: ${field}`)
        }
      }
      solution = copy
    },
    snapshot: (): ScriptSolution => structuredClone(solution),
  }
}
