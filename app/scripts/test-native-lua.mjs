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
  const hook = { energy: 8000, epsilon: 1e-12, resolution: .001, energyScanQz: .03, renewOpticalConstants: 1 }
  const sources = [
    "assert(type(delta)=='userdata'); delta[1]=par[0]; thickness[1]=97.5; sigma[1]=2; energy=energy+1",
    "calls=(calls or 0)+1; beta[1]=calls/100000; resolution='0.002'; renewocs=99",
    `local alias=array.new(1,3); array.set(alias,'1',125); assert(array.get(thickness,1)==125); assert(array.size(delta)==${project.sample.layers.length - 1}); assert(array.size(gauss_z)==-1)`,
    "maggamma[1]=37; magphi[1]=63; density[1]=3; deltam[1]=1e-6; betam[1]=2e-7",
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
      session.compile(source, 'BeforeCalculation')
      let result
      for (let index = 0; index < 2; ++index) result = session.runHook(hook)
      expected.push(JSON.parse(JSON.stringify({ ok: true, project: workspace.snapshot(), hook: result })))
    } catch { expected.push({ ok: false }) }
    finally { session.close() }
    assert.deepEqual(project, original)
    requests.push({ project: JSON.stringify(project), source, repeat: 2 })
  }
  assert.equal(expected.filter(result => result.ok).length, 5)
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
  console.log(`Native/Wasmoon scalar and array sessions: ${sources.length} parity cases and one native protected-readback case passed.`)
} finally { await server.close() }
