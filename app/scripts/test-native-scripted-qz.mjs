// Focused real terminal / actual-WASM script-to-solver integration.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import * as adapter from '../../engine/wasm/parratt.mjs'
import * as segmentation from '../../engine/wasm/segmentation.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root,'build/engine/remagx-terminal'))
const {default:createCore} = await import(pathToFileURL(resolve(process.argv[3] ?? resolve(root,'build/wasm'),'remagx-core.mjs')))
const core = await createCore()
const engine = {
  elementPreparation: {
    errorSamples:Array.from(adapter.generateErrorFunctionLookup(core)),
    density:request=>adapter.calculateElementDensity(core,request),
    optics:request=>adapter.calculateElementOptics(core,request),
  },
  segmentation: {
    errorSamples:Array.from(adapter.generateErrorFunctionLookup(core)),
    sample:request=>segmentation.calculateSegmentedOptics(core,request),
    prepareSampler:request=>segmentation.createSegmentedOpticalSampler(core,request),
    subdivide:request=>segmentation.calculateAdaptiveSegments(core,request),
    density:request=>adapter.calculateLayerDensity(core,request),
    apply:request=>adapter.applyMagneticProfiles(core,request),
  },
  calculate: request=>adapter.calculateParrattQz(core,request),
  matrixQz: request=>adapter.calculateVisnovskyQz(core,request),
  zakQz: request=>adapter.calculateZakQz(core,request),
  dielectricTensor: request=>adapter.calculateDielectricTensor(core,request),
  scatteringTensor: request=>adapter.calculateScatteringTensor(core,request),
  lookup:(table,queries,cursor)=>adapter.lookupTable(core,table,queries,cursor),
}
const server = await createServer({root:resolve(root,'app'),configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom'})
const directory = await mkdtemp(resolve(tmpdir(),'remagx-scripted-qz-'))
try {
  const {storedOpticalState} = await server.ssrLoadModule('/src/model/storedOpticalState.ts')
  const {createDefaultProject} = await server.ssrLoadModule('/src/model/defaults.ts')
  const {importAllFile} = await server.ssrLoadModule('/src/import/allFile.ts')
  const {parseOpticalTable} = await server.ssrLoadModule('/src/import/tables.ts')
  const {calculateRealCurve} = await server.ssrLoadModule('/src/model/realCalculation.ts')
  const {createBeforeCalculation} = await server.ssrLoadModule('/src/compute/lua/beforeCalculation.ts')
  const {createLuaRuntime} = await server.ssrLoadModule('/src/compute/lua/runtime.ts')
  const runtime = createLuaRuntime(resolve(root,'app/node_modules/wasmoon/dist/glue.wasm'))
  const dataset = importAllFile(await readFile(resolve(root,'app/test/fixtures/Tut2.all'),'utf8'),'Tut2.all').project.datasets[0]
  const tables = []
  for (const [kind,text] of [['db','7000 0.00001 0.0000001\n9000 0.00002 0.0000002'],['m','7000 0.000001 0.0000001\n9000 0.000002 0.0000002']]) {
    await writeFile(resolve(directory,`public.${kind}`),text)
    tables.push(parseOpticalTable(text,`public.${kind}`))
  }
  const vacuum = '7000 0 0\n9000 0 0'
  await writeFile(resolve(directory,'vacuum.db'),vacuum)
  tables.push(parseOpticalTable(vacuum,'vacuum.db'))
  for (const [kind,text] of [['ff','7000 24 2\n9000 26 2'],['ffm','7000 0.4 0.1\n9000 0.4 0.1']]) {
    await writeFile(resolve(directory,`Fe.${kind}`),text); tables.push(parseOpticalTable(text,`Fe.${kind}`))
  }
  const filename = resolve(directory,'project.json')
  let count = 0
  let base
  for (const roughness of ['nevot-croce','segmentation','element']) for (const automatic of [false,true]) for (const algorithm of ['parratt','matrix','zak']) for (const dichroic of [false,true]) for (const broadened of dichroic?[false]:[false,true]) {
    const project = createDefaultProject()
    project.calculation.algorithm = algorithm
    project.calculation.automaticOpticalConstants = automatic
    project.calculation.roughnessModel = roughness === 'element' ? 'nevot-croce' : roughness
    project.calculation.magnetization.mode = 'add'
    project.sample.multilayer.enabled = false
    project.experiment.energy = 8000
    project.experiment.qzScan = {qzMin:0,qzMax:0.2,points:7,useDatasetPoints:false,showAngle:false}
    project.experiment.resolution.energyFwhm = broadened ? 10 : 0
    project.sample.layers.forEach(layer=>{layer.opticalTable='public'})
    project.sample.layers.at(-1).opticalTable='vacuum'
    project.scripts.enabled = true
    project.scripts.beforeCalculation = automatic
      ? "thickness[1]=42; SetDeltaBeta(1,8100); FillTensors(); exy_r[1]=0; energy=8010; resolution=0.001; print('public-script')"
      : "thickness[1]=42; delta[1]=0.00002; deltam[1]=0.000002; FillTensors(); energy=8010; resolution=0.001; print('public-script')"
    if (roughness === 'segmentation') {
      project.calculation.magnetization.mode = 'profile'
      project.sample.layers[1].thickness = 12
      project.sample.depthProfileFunctions = [{center:10,width:5,deltaAmplitude:1e-6,betaAmplitude:4e-7,
        boundToLayer:project.sample.layers.length-2,amplitudeCoupledTo:null,widthCoupledTo:null,spline:{enabled:false,points:[]}}]
      project.scripts.beforeCalculation += '; gauss_delta[0]=0.000002; gauss_z[0]=14'
    }
    if (roughness === 'element') {
      project.sample.mode='element'
      project.calculation.segmentation.minThickness=0.5
      project.calculation.segmentation.tolerance=1e-9
      project.calculation.magnetization.direction={gamma:47,phi:61}
      project.sample.elementProfiles=[{element:'Fe',f1:25,f2:2,f1Mag:0.4,f2Mag:0.1,
        slabs:[{thickness:900,density:0.08,roughness:3},{thickness:27,density:0.09,roughness:2},{thickness:800,density:0,roughness:7}]}]
      project.sample.elementProfiles[0].scatteringTensor=Array.from(adapter.calculateScatteringTensor(core,
        {factors:[25,2,0.4,0.1],gamma:47,phi:61,tensor:0,magnetic:1}))
      project.scripts.beforeCalculation="assert(Fe:getf1()==25); Fe:setf(8100); f1[0]=f1[0]+0.5; Fe:setdensity(1,0.12); Fe:setthickness(1,42); FillTensors(); energy=8010; resolution=0.001; print('public-script')"
    }
    if (broadened) {
      project.scripts.beforeCalculation = "calls=(calls or 0)+1; assert(calls==1); " + project.scripts.beforeCalculation
        .replace('thickness[1]=42','thickness[1]=thickness[1]+1')
        .replace('Fe:setthickness(1,42)','Fe:setthickness(1,Fe:getthickness(1)+1)')
        .replace('SetDeltaBeta(1,8100)',"SetDeltaBeta(1,energy); SetName(1,'missing')")
        .replace('delta[1]=0.00002',"SetDeltaBeta(1,energy); SetName(1,'missing')")
        .replace('energy=8010','energy=energy+1')
        .replace('gauss_z[0]=14','gauss_z[0]=gauss_z[0]+0.1')
      if (roughness==='element') project.scripts.beforeCalculation=project.scripts.beforeCalculation.replace('assert(Fe:getf1()==25); ','')
    }
    base = project
    const text = JSON.stringify(project)
    await writeFile(filename,text)
    const run = spawnSync(executable,[dichroic?'-dicrefl':'-refl',filename],{cwd:directory,encoding:'utf8',timeout:10000})
    assert.equal(await readFile(filename,'utf8'),text)
    const reference = structuredClone(project)
    const qz = Array.from({length:7},(_,index)=>index/6*0.2)
    reference.datasets = [{...structuredClone(dataset),qzShift:0,energyShift:0,columns:{qz}}]
    reference.activeDatasetIndex=0; reference.experiment.qzScan.useDatasetPoints=true
    const session = await runtime.createSession(), messages=[]
    try {
      const hook = createBeforeCalculation(session,engine,tables,message=>messages.push(message))
      const expected = calculateRealCurve(reference,tables,engine,'qz',dichroic?'dichroic':'monochromatic',reference.sample.mode==='element'?storedOpticalState(reference):undefined,hook)
      assert.equal(run.status,0,`${roughness}/${algorithm}/${automatic}/${dichroic}/${broadened}: ${run.stderr||String(run.error)}`)
      const messagesInTerminal=run.stderr.trim().split('\n')
      assert.ok(messagesInTerminal.every(line=>line==='public-script'||/^Layer 1: missing\/empty \.db table/.test(line)))
      assert.equal(messagesInTerminal.filter(line=>line==='public-script').length,broadened?19:1)
      const rows=run.stdout.trim().split('\n').map(line=>line.split(/\s+/).map(Number))
      assert.equal(rows.length,qz.length); assert.deepEqual(messages,Array(broadened?19:1).fill('public-script'))
      rows.forEach((row,index)=>{
        assert.equal(row.length,dichroic?3:2); assert.equal(row[0],qz[index])
        const values=[expected.reflectivityPlus[index],expected.reflectivityMinus[index]]
        row.slice(1).forEach((value,column)=>assert.ok(Number.isFinite(value)&&Math.abs(value-values[column])<=1e-15+1e-10*Math.abs(values[column]),
          `Scripted ${roughness} ${algorithm} ${automatic} ${dichroic} ${broadened}: row ${index}, column ${column}`))
      })
    } finally {session.close()}
    count++
  }
  for (const edit of [project=>{project.scripts.beforeCalculation="error('public script failure')"},
    project=>{project.scripts.beforeCalculation="element.new(999)"},project=>{project.experiment.resolution.energyFwhm=1;project.calculation.postProcessing.fourierTransform=true}]) {
    const project=structuredClone(base); edit(project); await writeFile(filename,JSON.stringify(project))
    const run=spawnSync(executable,['-refl',filename],{cwd:directory,encoding:'utf8',timeout:10000})
    assert.equal(run.status,1); assert.equal(run.stdout,'')
    if (project.scripts.beforeCalculation.includes('public script failure')) assert.match(run.stderr,/Lua execution failed: BeforeCalculation:1: public script failure/)
  }
  for (const hard of [false,true]) {
    const project=structuredClone(base)
    project.scripts.beforeCalculation=(hard?'debug.sethook(); ':'')+"print('ready'); while true do end"
    await writeFile(filename,JSON.stringify(project))
    await new Promise((accept,reject)=>{
      const child=spawn(executable,['-refl',filename],{cwd:directory,stdio:['ignore','pipe','pipe']})
      let stdout='',stderr='',signalled=false,second
      const deadline=setTimeout(()=>{child.kill('SIGKILL'); reject(new Error('Native script stop deadline exceeded'))},3000)
      child.stdout.on('data',chunk=>{stdout+=chunk})
      child.stderr.on('data',chunk=>{
        stderr+=chunk
        if (!signalled && stderr.includes('ready')) {
          signalled=true; child.kill('SIGINT')
          if(hard) second=setTimeout(()=>child.kill('SIGINT'),100)
        }
      })
      child.on('error',error=>{clearTimeout(deadline);clearTimeout(second);reject(error)})
      child.on('close',(code,signal)=>{
        clearTimeout(deadline);clearTimeout(second)
        try {
          assert.ok(signalled);assert.equal(stdout,'')
          if(hard) assert.equal(signal,'SIGINT')
          else {assert.equal(code,1);assert.match(stderr,/Lua execution cancelled/)}
          accept()
        } catch(error) {reject(error)}
      })
    })
  }
  console.log(`Scripted native terminal qz: ${count} actual-WASM comparisons three rejection cases and two real SIGINT checks passed.`)
} finally {await server.close(); await rm(directory,{recursive:true,force:true})}
