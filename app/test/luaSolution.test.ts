import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createScriptSolutionWorkspace, type ScriptSolution } from '../src/model/scriptSolution'
import { createScriptArrayWorkspace } from '../src/model/scriptArrays'
import { createDefaultProject } from '../src/model/defaults'
const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
const fixture = (): ScriptSolution => ({ qz: [.01, .02], reflectivity: [.1, .2],
  reflectivityPlus: [.11, .21], reflectivityMinus: [.09, .19], energy: [700, 701] })

it('keeps userdata and aliases live across replacement, with legacy dynamic bounds and size', async () => {
  const solution = createScriptSolutionWorkspace()
  const project = createDefaultProject(); project.scripts.parameters = [1, 2, 3]
  const scalars = createScriptArrayWorkspace(project)
  const session = await runtime.createSession()
  try {
    session.installArrays(new Map([...scalars.arrays, ...solution.arrays]), solution.dynamicMaximumIndex)
    session.execute('alias = array.new(-1, 7); scalarAlias = array.new(-1, 34); assert(array.size(solution_R) == -1)', 'Default')
    const first = fixture()
    solution.replace(first)
    session.execute(`
      assert(solution_qz[1] == 0.02 and solution_R[1] == 0.2)
      assert(solution_Rp[1] == 0.21 and solution_Rm[1] == 0.19)
      assert(solution_energy[1] == 701 and math.type(solution_energy[1]) == "float")
      alias[0] = 0.5
      solution_Rp[0] = 0.6; solution_Rm[0] = 0.4
      solution_energy[0] = 702; solution_qz[0] = 0.03
      scalarAlias[1] = 9
      assert(not pcall(function() return scalarAlias[2] end))
    `, 'Default')
    expect(solution.snapshot()).toEqual({ qz: [.03, .02], reflectivity: [.5, .2],
      reflectivityPlus: [.6, .21], reflectivityMinus: [.4, .19], energy: [702, 701] })
    expect(first).toEqual(fixture())
    expect(scalars.snapshot().scripts.parameters).toEqual([1, 9, 3])
    solution.replace({ qz: [.1], reflectivity: [.75], reflectivityPlus: [], reflectivityMinus: [], energy: [] })
    session.execute(`
      assert(alias[0] == 0.75 and array.size(alias) == -1)
      assert(not pcall(function() return alias[1] end))
      assert(not pcall(function() return solution_energy[0] end))
    `, 'Default')
    solution.replace({ qz: [], reflectivity: [], reflectivityPlus: [], reflectivityMinus: [], energy: [] })
    expect(() => session.execute('local x = alias[0]', 'Default')).toThrow(/Default:1:.*index out of range/)
  } finally { session.close() }
})

it('respects explicit alias bounds independently of qz and rejects invalid replacements atomically', async () => {
  const solution = createScriptSolutionWorkspace()
  const first = fixture(); first.qz = [.01]
  solution.replace(first)
  const session = await runtime.createSession()
  try {
    session.installArrays(solution.arrays, solution.dynamicMaximumIndex)
    session.execute(`
      assert(not pcall(function() return solution_R[1] end))
      local fixed = array.new(1, 7)
      assert(fixed[1] == 0.2 and array.size(fixed) == 1)
      assert(not pcall(function() fixed[2] = 1 end))
    `, 'Default')
    const invalid = fixture(); invalid.energy[1] = Infinity
    expect(() => solution.replace(invalid)).toThrow('energy')
    expect(solution.snapshot()).toEqual(first)
    const snapshot = solution.snapshot(); snapshot.qz[0] = 99
    expect(solution.snapshot().qz).toEqual([.01])
  } finally { session.close() }
})
