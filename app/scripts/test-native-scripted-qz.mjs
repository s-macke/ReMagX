// Focused real terminal / actual-WASM script-to-solver integration.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import * as adapter from '../../engine/wasm/parratt.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root,'build/engine/remagx-terminal'))
const {default:createCore} = await import(pathToFileURL(resolve(process.argv[3] ?? resolve(root,'build/wasm'),'remagx-core.mjs')))
const core = await createCore()
const engine = {
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
  const filename = resolve(directory,'project.json')
  let count = 0
  let base
  for (const automatic of [false,true]) for (const algorithm of ['parratt','matrix','zak']) for (const dichroic of [false,true]) {
    const project = createDefaultProject()
    project.calculation.algorithm = algorithm
    project.calculation.automaticOpticalConstants = automatic
    project.calculation.roughnessModel = 'nevot-croce'
    project.calculation.magnetization.mode = 'add'
    project.sample.multilayer.enabled = false
    project.experiment.energy = 8000
    project.experiment.qzScan = {qzMin:0,qzMax:0.2,points:7,useDatasetPoints:false,showAngle:false}
    project.experiment.resolution.energyFwhm = 0
    project.sample.layers.forEach(layer=>{layer.opticalTable='public'})
    project.sample.layers.at(-1).opticalTable='vacuum'
    project.scripts.enabled = true
    project.scripts.beforeCalculation = automatic
      ? "thickness[1]=42; SetDeltaBeta(1,8100); FillTensors(); exy_r[1]=0; energy=8010; resolution=0.001; print('public-script')"
      : "thickness[1]=42; delta[1]=0.00002; deltam[1]=0.000002; FillTensors(); energy=8010; resolution=0.001; print('public-script')"
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
      const expected = calculateRealCurve(reference,tables,engine,'qz',dichroic?'dichroic':'monochromatic',undefined,hook)
      assert.equal(run.status,0,`${algorithm}/${automatic}/${dichroic}: ${run.stderr||String(run.error)}`)
      assert.equal(run.stderr,'public-script\n')
      const rows=run.stdout.trim().split('\n').map(line=>line.split(/\s+/).map(Number))
      assert.equal(rows.length,qz.length); assert.deepEqual(messages,['public-script'])
      rows.forEach((row,index)=>{
        assert.equal(row.length,dichroic?3:2); assert.equal(row[0],qz[index])
        const values=[expected.reflectivityPlus[index],expected.reflectivityMinus[index]]
        row.slice(1).forEach((value,column)=>assert.ok(Number.isFinite(value)&&Math.abs(value-values[column])<=1e-15+1e-10*Math.abs(values[column]),
          `Scripted ${algorithm} ${automatic} ${dichroic}: row ${index}, column ${column}`))
      })
    } finally {session.close()}
    count++
  }
  for (const edit of [project=>{project.scripts.beforeCalculation="error('public failure')"},
    project=>{project.calculation.roughnessModel='segmentation'},project=>{project.experiment.resolution.energyFwhm=1}]) {
    const project=structuredClone(base); edit(project); await writeFile(filename,JSON.stringify(project))
    const run=spawnSync(executable,['-refl',filename],{cwd:directory,encoding:'utf8',timeout:10000})
    assert.equal(run.status,1); assert.equal(run.stdout,'')
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
