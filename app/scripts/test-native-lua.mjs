// Focused public array/session parity against the existing Wasmoon runtime.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/project_lua_tests'))
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { createScriptArrayWorkspace } = await server.ssrLoadModule('/src/model/scriptArrays.ts')
  const { createLuaRuntime } = await server.ssrLoadModule('/src/compute/lua/runtime.ts')
  const runtime = createLuaRuntime(resolve(root, 'app/node_modules/wasmoon/dist/glue.wasm'))
  const project = createDefaultProject()
  project.scripts.parameters = [1.0000000000000002, 2]
  project.sample.depthProfileFunctions = []
  project.sample.elementProfiles = ['Fe', 'Co'].map(element => ({ element,
    f1: 1, f2: 2, f1Mag: 3, f2Mag: 4,
    slabs: [{ thickness: 0, roughness: 0, density: 0 },
      { thickness: 20, roughness: 2, density: 0.1 }] }))
  const hook = { energy: 8000, epsilon: 1e-12, resolution: .001, energyScanQz: .03, renewOpticalConstants: 1 }
  const sources = [
    "assert(type(delta)=='userdata'); delta[1]=par[0]; thickness[1]=97.5; sigma[1]=2; energy=energy+1",
    "calls=(calls or 0)+1; beta[1]=calls/100000; resolution='0.002'; renewocs=99",
    `local alias=array.new(1,3); array.set(alias,'1',125); assert(array.get(thickness,1)==125); assert(array.size(delta)==${project.sample.layers.length - 1}); assert(array.size(gauss_z)==-1)`,
    "maggamma[1]=37; magphi[1]=63; density[1]=3; deltam[1]=1e-6; betam[1]=2e-7",
    "Fe:setf1(par[0]); assert(f1[0]==par[0]); f2[1]=7; assert(Co:getf2()==7); Fe:setf1m(0.25); Co:setf2m(0.5)",
    "local e=element.new('0.9'); e:setthickness(1.9,42); element.setsigma(Fe,1,3); Fe:setdensity(1,0.125); assert(e:getthickness(1)==42 and e:getsigma(1)==3 and e:getdensity(1)==0.125)",
    "Fe:set(nil,123); assert(Co:get()==123); local e=element.new(1); e:setf1(9); assert(Co:getf1()==9)",
    "element.new(2)", "Fe:getdensity(2)", "Fe:setf2m(0/0)", "Fe:setf(8000)",
    "Start=function() energy=42 end", "delta[0.5]=1", "delta[100]=1", "delta[1]=0/0",
    "gauss_z[0]=1", "array.new(1,999)", "energy={}", "error('public diagnostic')", "local =",
  ]
  const requests = [], expected = []
  for (const source of sources) {
    const original = structuredClone(project)
    const workspace = createScriptArrayWorkspace(project)
    const session = await runtime.createSession()
    try {
      session.installArrays(workspace.arrays)
      session.installElements(workspace.elements)
      session.compile(source, 'BeforeCalculation')
      let result
      for (let index = 0; index < 2; ++index) result = session.runHook(hook)
      expected.push(JSON.parse(JSON.stringify({ ok: true, project: workspace.snapshot(), hook: result })))
    } catch { expected.push({ ok: false }) }
    finally { session.close() }
    assert.deepEqual(project, original)
    requests.push({ project: JSON.stringify(project), source, repeat: 2 })
  }
  assert.equal(expected.filter(result => result.ok).length, 8)
  const replacement = structuredClone(project)
  replacement.experiment.energy = 7123.456789012345
  replacement.sample.layers[1].thickness = 81
  replacement.sample.elementProfiles[0].f1 = 8
  const changedStructure = structuredClone(replacement)
  changedStructure.sample.elementProfiles[0].element = 'Ni'
  const workspaceSources = [
    "calls=(calls or 0)+1; saved=saved or element.new(0); a=a or array.new(1,3); a[1]=a[1]+calls; saved:setf1(saved:getf1()+calls); energy=energy+0.123456789; epsilon=epsilon*2; resolution=resolution+0.001; energyscan_qz=energyscan_qz+0.001",
    "energy=-1", "energy=0",
  ]
  const workspaceCases = workspaceSources.map(source => ({ source, replacement }))
  workspaceCases.push({ source: workspaceSources[0], replacement: changedStructure })
  for (const test of workspaceCases) {
    const workspace = createScriptArrayWorkspace(project)
    const session = await runtime.createSession()
    try {
      session.installArrays(workspace.arrays); session.installElements(workspace.elements)
      session.compile(test.source, 'BeforeCalculation')
      let result
      for (let index = 0; index < 3; ++index) {
        if (index) workspace.replace(test.replacement, 1)
        result = session.runHook(workspace.beginHook())
        workspace.applyHook(result)
      }
      expected.push(JSON.parse(JSON.stringify({ ok: true, project: workspace.snapshot(), hook: result })))
    } catch { expected.push({ ok: false }) } finally { session.close() }
    requests.push({ project: JSON.stringify(project), source: test.source, repeat: 3,
      workspace: true, replacement: JSON.stringify(test.replacement) })
  }
  assert.equal(expected.filter(result => result.ok).length, 9)
  // Native protected global readback: Wasmoon currently panics on this metatable,
  // so this regression is deliberately not presented as a parity comparison.
  requests.push({ project: JSON.stringify(project),
    source: "energy=nil; setmetatable(_G,{__index=function() error('readback') end})" })
  expected.push({ ok: false })
  const run = spawnSync(executable, [], { input: requests.map(value => JSON.stringify(value)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000 })
  assert.equal(run.status, 0, run.stderr || String(run.error))
  const actual = run.stdout.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(actual, expected)
  console.log(`Native/Wasmoon scalar and array sessions: ${sources.length + workspaceCases.length} parity cases and one native protected-readback case passed.`)
} finally { await server.close() }
