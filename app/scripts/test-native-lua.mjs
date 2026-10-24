// Focused public array/session parity against the existing Wasmoon runtime.
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { lookupTable, calculateGaussLorentzianReal, calculateGaussLorentzianImag, calculateDielectricTensor, calculateScatteringTensor } from '../../engine/wasm/parratt.mjs'
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
  const { createScriptFactorLookup } = await server.ssrLoadModule('/src/model/scriptFactors.ts')
  const { parseOpticalTable } = await server.ssrLoadModule('/src/import/tables.ts')
  const { default: createCore } = await import(pathToFileURL(resolve(process.argv[3] ?? resolve(root, 'build/wasm'), 'remagx-core.mjs')))
  const core = await createCore()
  const primary = { name: 'Fe', kind: 'ff', text: '7000 1 2\n8000 3 4\n8000 5 6\n9000 7 8' }
  const magnetic = { name: 'Fe', kind: 'ffm', text: '7500 0.1 0.2\n8500 0.3 0.4' }
  const tensor = { name: 'Fe', kind: 'f', text: [7000, 9000].map(energy =>
    [energy, ...Array.from({length: 18}, (_, index) => index + energy / 1000)].join(' ')).join('\n') }
  const tableCases = [[], [primary], [primary, magnetic], [primary, magnetic, tensor], [primary, { ...magnetic, text: "# empty" }, magnetic],
    [{ ...primary, text: '# empty table' }], [{ ...primary, name: 'Co' }]]
  for (const tables of tableCases) {
    const source = "calls=(calls or 0)+1; Fe:setf(({8000,7500,9000,6000})[calls]); par[0]=par[0]+calls*Fe:getf1(); par[1]=par[1]+calls*Fe:getf1m(); beta[1]=beta[1]+calls*Fe:getf2(); betam[1]=betam[1]+calls*Fe:getf2m()"
    const workspace = createScriptArrayWorkspace(project)
    const session = await runtime.createSession()
    try {
      const parsed = tables.map(table => parseOpticalTable(table.text, `${table.name}.${table.kind}`))
      session.installArrays(workspace.arrays)
      session.installElements(workspace.elements, createScriptFactorLookup(parsed,
        (table, queries, cursor) => lookupTable(core, table, queries, cursor)))
      session.compile(source, 'BeforeCalculation')
      let result
      for (let index = 0; index < 4; ++index) result = session.runHook(hook)
      expected.push(JSON.parse(JSON.stringify({ ok: true, project: workspace.snapshot(), hook: result })))
    } catch { expected.push({ ok: false }) } finally { session.close() }
    requests.push({ project: JSON.stringify(project), source, repeat: 4, tables })
  }
  assert.equal(expected.filter(result => result.ok).length, 16)
  const { createScriptTensorWorkspace } = await server.ssrLoadModule('/src/model/scriptTensors.ts')
  const initialTensors = Array.from({length: project.sample.layers.length}, (_, layer) => ({
    values: Array.from({length: 18}, (_, index) => layer + index / 100), anisotropic: false }))
  const replacementTensors = initialTensors.map(tensor => ({values: tensor.values.map(value => value + 1), anisotropic: false}))
  const tensorNames = ['xx','xy','xz','yx','yy','yz','zx','zy','zz'].flatMap(name => [`e${name}_r`, `e${name}_i`])
  const tensorCases = [
    { source: tensorNames.map((name, index) => `par[0]=${name}[1]; ${name}[1]=par[0]+${index}/1000`).join('; ') },
    { source: "local value=exx_r[0]; assert(value>=0); Fe:setf1(7); assert(f1[0]==7)" },
    { source: "saved=saved or array.new(1,33); saved[1]=saved[1]+0.25; f1[0]=9; assert(Fe:getf1()==9)", replacementTensors },
    { source: "local value=exx_r[0]", replacementTensors: [] },
    { source: "array.new(1,24)" }, { source: "ezz_i[100]=1" }, { source: "exx_r[0]=0/0" },
  ]
  for (const test of tensorCases) {
    const workspace = createScriptArrayWorkspace(project)
    const decode = values => values.map(tensor => ({...tensor, values: Float64Array.from(tensor.values)}))
    const tensors = createScriptTensorWorkspace(decode(initialTensors))
    const session = await runtime.createSession()
    try {
      session.installArrays(new Map([...workspace.arrays, ...tensors.arrays])); session.installElements(workspace.elements)
      session.compile(test.source, 'BeforeCalculation')
      let result
      for (let index = 0; index < 2; ++index) {
        if (index && test.replacementTensors) tensors.replace(decode(test.replacementTensors))
        result = session.runHook(hook)
      }
      expected.push(JSON.parse(JSON.stringify({ok: true, project: workspace.snapshot(), hook: result,
        tensors: tensors.snapshot().map(tensor => ({...tensor, values: Array.from(tensor.values)}))})))
    } catch { expected.push({ok: false}) } finally { session.close() }
    requests.push({project: JSON.stringify(project), ...test, tensors: initialTensors, repeat: 2})
  }
  assert.equal(expected.filter(result => result.ok).length, 19)
  const { createScriptSolutionWorkspace } = await server.ssrLoadModule('/src/model/scriptSolution.ts')
  const initialSolution = {qz: [0.01,0.02], reflectivity: [0.5,0.25], reflectivityPlus: [0.6,0.3],
    reflectivityMinus: [0.4,0.2], energy: [7000,8000]}
  const replacementSolution = Object.fromEntries(Object.entries(initialSolution).map(([key, values]) => [key, [...values, values[1]]]))
  const solutionCases = [
    {source: "assert(array.size(solution_qz)==-1); solution_R[1]=solution_Rp[1]+solution_Rm[1]; solution_energy[0]=7100; solution_qz[0]=0.015"},
    {source: "calls=(calls or 0)+1; saved=saved or array.new(-1,7); saved[calls]=0.125; par[0]=saved[calls]", replacementSolution},
    {source: "local a=array.new(-1,3); a[1]=123; assert(thickness[1]==123)"},
    {source: "local a=array.new(-1,3); a[2]=123"},
    {source: "solution_R[1]=0.2", solution: {...initialSolution, reflectivity: []}},
    {source: "solution_energy[2]=7000", solution: {...initialSolution, energy: [1,2,3]}},
    {source: "solution_R[0]=0/0"},
  ]
  for (const test of solutionCases) {
    const workspace = createScriptArrayWorkspace(project)
    const solution = createScriptSolutionWorkspace()
    const initial = test.solution ?? initialSolution
    solution.replace(initial)
    const session = await runtime.createSession()
    try {
      session.installArrays(new Map([...workspace.arrays, ...solution.arrays]), solution.dynamicMaximumIndex)
      session.installElements(workspace.elements); session.compile(test.source, 'BeforeCalculation')
      let result
      for (let index = 0; index < 2; ++index) {
        if (index && test.replacementSolution) solution.replace(test.replacementSolution)
        result = session.runHook(hook)
      }
      expected.push(JSON.parse(JSON.stringify({ok:true, project:workspace.snapshot(), hook:result, solution:solution.snapshot()})))
    } catch { expected.push({ok:false}) } finally { session.close() }
    requests.push({project:JSON.stringify(project), ...test, solution:initial, repeat:2})
  }
  assert.equal(expected.filter(result => result.ok).length, 22)
  const functionCases = [
    "SetName(1.9,'Fe'); SetChemicalFormula(1,'Fe2O3'); SetName(1); SetChemicalFormula(1,'ignored',3)",
    "SetName({},123); SetChemicalFormula(1,nil); SetName(1,'Fe'..string.char(0)..'ignored')",
    "SetName(100,'Fe')", "SetName(1,{})",
    "energy=9000; par[0]=GetGaussLorentzianImag(8000,2,5,25); par[1]=GetGaussLorentzianReal(8000,2,0,25)",
    "par[0]=GetGaussLorentzianImag('8000','2','5','25'); assert(GetGaussLorentzianReal(1)==nil)",
    "assert(CalculateDicReflectivity(1,2)==nil); assert(CalculateEnergyscan({})==nil)",
    "KramersKronigRange()", "ShowMatrixEigenvalues()", "ShowEScanEigenvalues()", "FillTensors()", "SetDeltaBeta(1,8000)",
  ]
  for (const source of functionCases) {
    const workspace = createScriptArrayWorkspace(project)
    const session = await runtime.createSession()
    try {
      session.installArrays(workspace.arrays); session.installElements(workspace.elements)
      session.installProjectFunctions({setLayerText: workspace.setLayerText,
        gaussLorentzianReal: (...values) => calculateGaussLorentzianReal(core, [workspace.calculationEnergy(), ...values]),
        gaussLorentzianImag: (...values) => calculateGaussLorentzianImag(core, [workspace.calculationEnergy(), ...values])})
      session.compile(source, 'BeforeCalculation')
      const result = session.runHook(hook)
      expected.push(JSON.parse(JSON.stringify({ok:true, project:workspace.snapshot(), hook:result})))
    } catch { expected.push({ok:false}) } finally { session.close() }
    requests.push({project:JSON.stringify(project), source, functions:true})
  }
  assert.equal(expected.filter(result => result.ok).length, 27)
  const { createScriptOptics } = await server.ssrLoadModule('/src/model/scriptOptics.ts')
  const { createScatteringTensorWorkspace } = await server.ssrLoadModule('/src/model/scatteringTensors.ts')
  const opticsCases = []
  for (const tensorMode of ['magnetic','tetragonal']) for (const magnetism of ['none','add']) {
    const input = structuredClone(project)
    input.calculation.tensorContribution = tensorMode; input.calculation.magnetization.mode = magnetism
    opticsCases.push({input, tables: [], source: "delta[1]=0.001; deltam[1]=0.0002; maggamma[1]=37; Fe:setf1(7); Fe:setf2m(0.25); FillTensors()"})
  }
  const opticalPrimary = {...primary, kind:'db'}
  for (const tables of [[], [opticalPrimary], [opticalPrimary, {...magnetic,kind:'m'}],
    [opticalPrimary, {...magnetic,kind:'m'}, {...tensor,kind:'e'}]]) {
    opticsCases.push({input:project, tables, source: "SetName(1,'Fe'); SetDeltaBeta(1,7500); SetName(1,'missing'); SetDeltaBeta(1,8000)"})
  }
  opticsCases.push({input:project, tables:[opticalPrimary], source:"SetName(1,'Fe'); SetDeltaBeta(1,6000)"})
  for (const test of opticsCases) {
    const workspace = createScriptArrayWorkspace(test.input)
    const tensors = createScriptTensorWorkspace(initialTensors.map(tensor => ({...tensor,values:Float64Array.from(tensor.values)})))
    const initialScattering = test.input.sample.elementProfiles.map(() => Array(18).fill(0))
    const scattering = createScatteringTensorWorkspace(initialScattering.map(values => Float64Array.from(values)))
    const session = await runtime.createSession()
    try {
      const parsed = test.tables.map(table => parseOpticalTable(table.text, `${table.name}.${table.kind}`))
      const optics = createScriptOptics(workspace, tensors, parsed,
        (table, queries, cursor) => lookupTable(core,table,queries,cursor),
        request => calculateDielectricTensor(core,request), new Map(), new Map(),
        {workspace:scattering,construct: request => calculateScatteringTensor(core,request)})
      session.installArrays(new Map([...workspace.arrays,...tensors.arrays])); session.installElements(workspace.elements)
      session.installProjectFunctions({...optics,setLayerText:workspace.setLayerText})
      session.compile(test.source,'BeforeCalculation')
      const result = session.runHook(hook)
      expected.push({ok:true,project:JSON.parse(JSON.stringify(workspace.snapshot())),hook:result,
        tensors:tensors.snapshot().map(tensor=>({...tensor,values:Array.from(tensor.values)})),
        scattering:scattering.snapshot().map(values=>Array.from(values))})
    } catch { expected.push({ok:false}) } finally { session.close() }
    requests.push({project:JSON.stringify(test.input),source:test.source,tables:test.tables,functions:true,
      tensors:initialTensors,scattering:initialScattering})
  }
  assert.equal(expected.filter(result=>result.ok).length,36)
  const outputCases = [
    {source:"print('Fe',123,nil,false,{},'!',1.2345678901234567); write('a'..string.char(0)..'b','c'); print(); par[0]=1.2345678901234567"},
    {source:"local p=print; type=nil; select=nil; string.format=nil; string.match=nil; table.concat=nil; p('value=',1.25)"},
    {source:"print('µ',1e-20,1e20,-0.0); write('next')"},
    {source:"local ok=pcall(print,'failure'); assert(not ok); par[0]=7", failOutput:true},
    {source:"print('failure')", failOutput:true},
  ]
  for (const test of outputCases) {
    const workspace = createScriptArrayWorkspace(project), messages = []
    const session = await runtime.createSession()
    try {
      session.installArrays(workspace.arrays); session.installElements(workspace.elements)
      session.installOutput(message => { if(test.failOutput) throw new Error('Public output failure'); messages.push(message) })
      session.compile(test.source,'BeforeCalculation')
      const result = session.runHook(hook)
      expected.push(JSON.parse(JSON.stringify({ok:true,project:workspace.snapshot(),hook:result,messages})))
    } catch { expected.push({ok:false}) } finally {session.close()}
    requests.push({project:JSON.stringify(project),...test,output:true})
  }
  assert.equal(expected.filter(result=>result.ok).length,40)
  const { createProjectScript } = await server.ssrLoadModule('/src/compute/lua/beforeCalculation.ts')
  const hookCases = [
    "error('public hook failure')",
    "calls=(calls or 0)+1; thickness[1]=thickness[1]+calls; Fe:setf1(calls); FillTensors(); energy=energy+1; print(calls,':',renewocs)",
    "calls=(calls or 0)+1; SetName(1,'Fe'); SetDeltaBeta(1,7500); Fe:setf(7500); exy_r[1]=calls/100; print(renewocs)",
  ]
  const hookTables = [opticalPrimary,primary,magnetic]
  for (const source of hookCases) {
    const projects = [0,1,2].map(index => { const value=structuredClone(project);
      value.experiment.energy=7500+index*100; value.scripts.beforeCalculation=source; return value })
    const parsed=hookTables.map(table=>parseOpticalTable(table.text,`${table.name}.${table.kind}`))
    const initialScattering=project.sample.elementProfiles.map(()=>Array(18).fill(0))
    const session=await runtime.createSession(), messages=[]
    try {
      const before=createProjectScript('BeforeCalculation',session,{
        lookup:(table,queries,cursor)=>lookupTable(core,table,queries,cursor),
        dielectricTensor:request=>calculateDielectricTensor(core,request),
        scatteringTensor:request=>calculateScatteringTensor(core,request)},parsed,message=>messages.push(message))
      const results=projects.map(value=>{
        const result=before(value,{layers:value.sample.layers,dielectricTensors:value.sample.layers.map(()=>null),
          dielectricState:initialTensors.map(tensor=>({...tensor,values:Float64Array.from(tensor.values)})),
          scatteringTensors:initialScattering.map(values=>Float64Array.from(values)),cursors:new Map()},1)
        return {project:JSON.parse(JSON.stringify(result.project)),
          tensors:result.opticalState.dielectricState.map(tensor=>({...tensor,values:Array.from(tensor.values)})),
          scattering:result.opticalState.scatteringTensors.map(values=>Array.from(values)),
          cursors:parsed.map(table=>result.opticalState.cursors.get(table)??0)}
      })
      expected.push({ok:true,results,messages})
    } catch {expected.push({ok:false})} finally {session.close()}
    requests.push({project:JSON.stringify(project),projectHook:true,tables:hookTables,
      hookProjects:projects.map(value=>JSON.stringify(value)),tensors:initialTensors,scattering:initialScattering})
  }
  assert.equal(expected.filter(result=>result.ok).length,42)
  // Native protected global readback: Wasmoon currently panics on this metatable,
  // so this regression is deliberately not presented as a parity comparison.
  requests.push({ project: JSON.stringify(project),
    source: "energy=nil; setmetatable(_G,{__index=function() error('readback') end})" })
  expected.push({ ok: false })
  const stopCases = [
    {source:"par[0]=7",stopAfter:1},
    {source:"while true do end",stopAfter:2},
    {source:"pcall(function() while true do end end); debug.sethook(); par[0]=7",stopAfter:2},
    {source:"while true do end",stopAfter:2,throwStop:true},
  ]
  for (const test of stopCases) {
    requests.push({project:JSON.stringify(project),...test})
    expected.push({ok:false,error:test.throwStop?'Lua stop callback failed':'Lua execution cancelled'})
  }
  requests.push({...requests[0],stopAfter:99999}); expected.push(expected[0])
  const run = spawnSync(executable, [], { input: requests.map(value => JSON.stringify(value)).join('\n') + '\n',
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000 })
  assert.equal(run.status, 0, run.stderr || String(run.error))
  const actual = run.stdout.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.equal(actual.length, expected.length)
  actual.forEach((result, index) => assert.ok(isDeepStrictEqual(result, expected[index]), `Native Lua case ${index + 1} differs from Wasmoon`))
  console.log(`Native/Wasmoon scalar and array sessions: ${sources.length + workspaceCases.length + tableCases.length + tensorCases.length + solutionCases.length + functionCases.length + opticsCases.length + outputCases.length + hookCases.length} parity cases and six native readback/cancellation cases passed.`)
} finally { await server.close() }
