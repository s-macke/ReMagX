import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const destination = resolve(root, 'build/real-service-test')
const wasmDirectory = resolve(process.argv[2] ?? resolve(root, 'build/wasm'))
await build({ configFile: false, root: resolve(root, 'app'), base: './', worker: { format: 'es' },
  build: { outDir: destination, emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'app/test/real-service/entry.ts'), output: { entryFileNames: 'entry.js' } } } })
await mkdir(resolve(destination, 'assets'), { recursive: true })
for (const file of ['remagx-core.mjs', 'remagx-core.wasm']) await copyFile(resolve(wasmDirectory, file), resolve(destination, 'assets', file))
const adapter = await readFile(resolve(root, 'engine/wasm/parratt.mjs'), 'utf8')
const entryCall = '    checkStatus(module._remagx_parratt_qz('
assert.ok(adapter.includes(entryCall))
// Test-only marker immediately before the actual synchronous C API call.
await writeFile(resolve(destination, 'assets/parratt.mjs'), adapter.replace(entryCall,
  '    if (qz.length >= 100000) self.postMessage({ realCoreEntered: true })\n' + entryCall))
const assets = new Map([['/', ['text/html', '<!doctype html><script type="module" src="./entry.js"></script>']]])
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await collect(path, `${prefix}/${entry.name}`)
    else assets.set(`${prefix}/${entry.name}`, [extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript', await readFile(path)])
  }
}
await collect(destination)
const server = createServer((request, response) => {
  const asset = assets.get(request.url)
  response.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.[0] ?? 'text/plain' })
  response.end(asset?.[1] ?? 'Not found')
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.waitForFunction(() => !!window.realServiceHarness)
  const results = await page.evaluate(async () => {
    const { createDefaultProject, createLayer, createRealComputeService } = window.realServiceHarness
    let enteredResolve
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        this.addEventListener('message', event => { if (event.data.realCoreEntered) enteredResolve?.() })
      }
    }
    const service = createRealComputeService()
    const project = createDefaultProject()
    project.sample.layers = [createLayer(), createLayer()]
    project.experiment.qzScan.points = 4
    const snapshot = JSON.stringify(project)
    const output = {}
    try {
      output.zero = await service.calcReflectivity(project)
      output.asymmetry = await service.calcAsymmetry(project)
      try { await service.calcEnergyScan(project) } catch (error) { output.unsupported = error.message }
      output.originalUnchanged = snapshot === JSON.stringify(project)
      project.sample.layers[0].delta = .01
      project.sample.layers[0].beta = .002
      project.experiment.qzScan.qzMin = 0
      project.experiment.qzScan.qzMax = 0
      output.totalReflection = await service.calcReflectivity(project)
      const postProject = structuredClone(project)
      postProject.experiment.qzScan.points = 2
      postProject.experiment.qzScan.qzMax = .02
      postProject.experiment.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
      output.postBaseline = await service.calcReflectivity(postProject)
      output.postEnergy = postProject.experiment.energy
      postProject.calculation.postProcessing.multiplyByQz4 = true
      postProject.calculation.postProcessing.divideByCos2ThetaSquared = true
      postProject.calculation.averaging = 1
      output.postprocessed = await service.calcReflectivity(postProject)
      const resolutionProject = createDefaultProject()
      resolutionProject.sample.layers = [createLayer({ delta: .01, beta: .002 }), createLayer()]
      resolutionProject.experiment.energy = 640
      resolutionProject.experiment.polarization.beam1 = { sigma: { re: 1, im: 0 }, pi: { re: 0, im: 0 } }
      resolutionProject.experiment.resolution.angularFwhm = .002
      resolutionProject.experiment.resolution.fastConvolution = false
      resolutionProject.experiment.qzScan.points = 2
      output.resolution = []
      for (const qz of [0, .03]) {
        resolutionProject.experiment.qzScan.qzMin = qz
        resolutionProject.experiment.qzScan.qzMax = qz
        output.resolution.push((await service.calcReflectivity(resolutionProject)).reflectivity[0])
      }
      // Queue a genuine large WASM request, then Stop using the production service lifecycle.
      const busy = structuredClone(project)
      busy.sample.layers = Array.from({ length: 1000 }, (_, index) => createLayer({ thickness: 10, delta: index % 2 ? .001 : .002, beta: .0001 }))
      busy.experiment.qzScan.points = 100000
      busy.experiment.qzScan.qzMax = .1
      let entryTimeout
      const entered = new Promise((resolve, reject) => {
        enteredResolve = resolve
        entryTimeout = setTimeout(() => reject(new Error('Real core did not start')), 10000)
      })
      const pending = service.calcReflectivity(busy).then(() => 'finished', error => error.name)
      try { await entered } finally { clearTimeout(entryTimeout) }
      const start = performance.now()
      service.stop()
      output.stopped = await pending
      output.restarted = await service.calcReflectivity(project)
      output.recoveryMilliseconds = performance.now() - start
      return output
    } finally { service.dispose(); window.Worker = NativeWorker }
  })
  assert.deepEqual(results.zero.reflectivity, [0, 0, 0, 0])
  assert.deepEqual(results.asymmetry.asymmetry, [0, 0, 0, 0])
  assert.match(results.unsupported, /does not support energyScan/)
  for (const value of results.totalReflection.reflectivity) assert.ok(Math.abs(value - 1) <= 1e-10 + 1e-15)
  const corrected = results.postBaseline.qz.map((qz, index) => {
    const wave = 2 * Math.PI / (12398.326 / results.postEnergy)
    const angle = Math.asin(qz / (2 * wave))
    return results.postBaseline.reflectivity[index] * (qz * qz * qz * qz) / (Math.cos(2 * angle) * Math.cos(2 * angle))
  })
  const mean = (corrected[0] + corrected[1]) / 2
  assert.equal(results.postprocessed.reflectivity[0], 0) // legacy unsigned leading-window behavior
  assert.ok(Math.abs(results.postprocessed.reflectivity[1] - mean) <= 1e-15 + 1e-10 * Math.abs(mean))
  // Synthetic original CParratt<double> values, weighted with the active legacy
  // 19-node kernel at energy 640 eV and width .002 inverse Angstrom.
  const resolutionReference = [.56005877016968919, .87413289596007782]
  results.resolution.forEach((value, index) => assert.ok(Math.abs(value - resolutionReference[index]) <= 1e-15 + 1e-10 * Math.abs(resolutionReference[index])))
  assert.equal(results.stopped, 'ComputeCancelled')
  assert.deepEqual(results.restarted, results.totalReflection)
  assert.ok(results.recoveryMilliseconds < 1000, `Stop and restart took ${results.recoveryMilliseconds} ms`)
  assert.equal(results.originalUnchanged, true)
  console.log(`Real ComputeService in Chromium: zero contrast, total reflection, asymmetry, postprocessing, angular resolution, unsupported operation and Stop/restart passed (${results.recoveryMilliseconds.toFixed(1)} ms).`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
