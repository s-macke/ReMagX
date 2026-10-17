import { createScriptFactorLookup } from '../../src/model/scriptFactors'
import type { OpticalTable } from '../../src/import/tables'
import { createScriptTensorWorkspace } from '../../src/model/scriptTensors'
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
    source.sample.elementProfiles = [{ element: 'Fe', f1: 26, f2: 1, f1Mag: 0, f2Mag: 0,
      slabs: [{ thickness: 10, density: 3, roughness: 2 }] }]
    const original = JSON.stringify(source)
    const workspace = createScriptArrayWorkspace(source)
    session.installProjectFunctions(workspace)
    session.execute('SetName(0, "test-table"); SetChemicalFormula(0, "Fe2O3")', 'Default')
    const functionsPassed = workspace.snapshot().sample.layers[0].opticalTable === 'test-table' &&
      workspace.snapshot().sample.layers[0].material === 'Fe2O3'
    const coreUrl = new URL('./remagx-core.mjs', self.location.href).href
    const adapterUrl = new URL('./parratt.mjs', self.location.href).href
    const [core, adapter] = await Promise.all([import(/* @vite-ignore */ coreUrl), import(/* @vite-ignore */ adapterUrl)])
    const instance = await core.default()
    const tables: OpticalTable[] = [
      { name: 'Fe', kind: 'ff', energy: [100, 200], columns: [[20, 40], [2, 4]], warnings: [] },
      { name: 'Fe', kind: 'ffm', energy: [120, 180], columns: [[1, 3], [2, 4]], warnings: [] },
    ]
    session.installElements(workspace.elements, createScriptFactorLookup(tables,
      (table, energy, cursor) => adapter.lookupTable(instance, table, energy, cursor)))
    const solution = createScriptSolutionWorkspace()
    const tensors = createScriptTensorWorkspace([{ values: new Float64Array(18).fill(.5), anisotropic: false }])
    session.installArrays(new Map([...workspace.arrays, ...solution.arrays, ...tensors.arrays]), solution.dynamicMaximumIndex)
    session.execute('Fe:setthickness(0, 12); Fe:setf1(24); assert(f1[0] == 24)', 'Default')
    const elementsPassed = workspace.snapshot().sample.elementProfiles[0].slabs[0].thickness === 12
    session.execute('assert(exy_i[0] == 0.5); ezz_r[0] = 0.75', 'Default')
    const tensorPassed = tensors.snapshot()[0].anisotropic && tensors.overrides()[0]?.[16] === .75
    session.execute('par[0] = 2.5; array.set(par, 1, -0.0); assert(type(par) == "userdata"); assert(math.type(par[0]) == "float")', 'Default')
    const parameters = workspace.snapshot().scripts.parameters
    const arraysPassed = parameters[0] === 2.5 && Object.is(parameters[1], -0) && JSON.stringify(source) === original
    solution.replace({ qz: [.01], reflectivity: [.5], reflectivityPlus: [], reflectivityMinus: [], energy: [] })
    session.execute('resultAlias = array.new(-1, 7); assert(solution_R[0] == 0.5 and array.size(solution_R) == -1)', 'Default')
    solution.replace({ qz: [.02], reflectivity: [.25], reflectivityPlus: [], reflectivityMinus: [], energy: [] })
    session.execute('assert(resultAlias[0] == 0.25); resultAlias[0] = 0.125', 'Default')
    const solutionPassed = solution.snapshot().reflectivity[0] === .125
    session.execute('Fe:setf(150); assert(math.abs(f1[0]-30) < 1e-10 and math.abs(Fe:getf2m()-3) < 1e-10)', 'Default')
    session.execute('Fe:setf(100); assert(f1[0] == 20 and Fe:getf1m() == 0 and Fe:getf2m() == 0); Fe:setf(99); assert(f1[0] == 20)', 'Default')
    const factorsPassed = workspace.snapshot().sample.elementProfiles[0].f1 === 20
    session.setGlobal('energy', 700.25)
    session.execute('energy = energy + 0.125; version = _VERSION', 'Default')
    const energy = session.getGlobal('energy')
    const version = session.getGlobal('version')
    let diagnostic = ''
    try {
      session.execute('local a = 1\na = a + 1\nKramersKronigRange()', 'BeforeCalculation')
    } catch (error) { diagnostic = String(error) }
    const replacement = await runtime.createSession()
    try {
      const isolated = replacement.getGlobal('energy') === null
      self.postMessage({ energy, version, diagnostic, isolated, arraysPassed, solutionPassed, tensorPassed, elementsPassed, factorsPassed, functionsPassed })
    } finally { replacement.close() }
  } finally { session.close() }
}
run().catch(error => self.postMessage({ error: String(error) }))
