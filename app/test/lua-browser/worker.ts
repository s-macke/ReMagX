import { createScriptSolutionWorkspace } from '../../src/model/scriptSolution'
import { createScriptArrayWorkspace } from '../../src/model/scriptArrays'
import { createDefaultProject } from '../../src/model/defaults'
import { createBrowserLuaRuntime } from '../../src/compute/lua/browserRuntime'

const runtime = createBrowserLuaRuntime()
async function run() {
  const session = await runtime.createSession()
  try {
    const source = createDefaultProject()
    source.scripts.parameters = [1, 2]
    const original = JSON.stringify(source)
    const workspace = createScriptArrayWorkspace(source)
    const solution = createScriptSolutionWorkspace()
    session.installArrays(new Map([...workspace.arrays, ...solution.arrays]), solution.dynamicMaximumIndex)
    session.execute('par[0] = 2.5; array.set(par, 1, -0.0); assert(type(par) == "userdata"); assert(math.type(par[0]) == "float")', 'Default')
    const parameters = workspace.snapshot().scripts.parameters
    const arraysPassed = parameters[0] === 2.5 && Object.is(parameters[1], -0) && JSON.stringify(source) === original
    solution.replace({ qz: [.01], reflectivity: [.5], reflectivityPlus: [], reflectivityMinus: [], energy: [] })
    session.execute('resultAlias = array.new(-1, 7); assert(solution_R[0] == 0.5 and array.size(solution_R) == -1)', 'Default')
    solution.replace({ qz: [.02], reflectivity: [.25], reflectivityPlus: [], reflectivityMinus: [], energy: [] })
    session.execute('assert(resultAlias[0] == 0.25); resultAlias[0] = 0.125', 'Default')
    const solutionPassed = solution.snapshot().reflectivity[0] === .125
    session.setGlobal('energy', 700.25)
    session.execute('energy = energy + 0.125; version = _VERSION', 'Default')
    const energy = session.getGlobal('energy')
    const version = session.getGlobal('version')
    let diagnostic = ''
    try {
      session.execute('local a = 1\na = a + 1\npar[2] = 3', 'BeforeCalculation')
    } catch (error) { diagnostic = String(error) }
    const replacement = await runtime.createSession()
    try {
      const isolated = replacement.getGlobal('energy') === null
      self.postMessage({ energy, version, diagnostic, isolated, arraysPassed, solutionPassed })
    } finally { replacement.close() }
  } finally { session.close() }
}
run().catch(error => self.postMessage({ error: String(error) }))
