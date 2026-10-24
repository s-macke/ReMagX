// Public synthetic projects only. The production web preparation and actual WASM
// core provide the reference; terminal coordinates follow the original CLI.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import * as adapter from '../../engine/wasm/parratt.mjs'
import * as segmentation from '../../engine/wasm/segmentation.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const executable = resolve(process.argv[2] ?? resolve(root, 'build/engine/remagx-terminal'))
const wasm = resolve(process.argv[3] ?? resolve(root, 'build/wasm'))
const { default: createCore } = await import(pathToFileURL(resolve(wasm, 'remagx-core.mjs')))
const instance = await createCore()
const engine = {
  scatteringTensor: request => adapter.calculateScatteringTensor(instance, request),
  elementPreparation: {
    errorSamples: Array.from(adapter.generateErrorFunctionLookup(instance)),
    density: request => adapter.calculateElementDensity(instance, request),
    optics: request => adapter.calculateElementOptics(instance, request),
  },
  segmentation: {
    errorSamples: Array.from(adapter.generateErrorFunctionLookup(instance)),
    sample: request => segmentation.calculateSegmentedOptics(instance, request),
    prepareSampler: request => segmentation.createSegmentedOpticalSampler(instance, request),
    subdivide: request => segmentation.calculateAdaptiveSegments(instance, request),
    density: request => adapter.calculateLayerDensity(instance, request),
    apply: request => adapter.applyMagneticProfiles(instance, request),
  },
  calculate: request => adapter.calculateParrattQz(instance, request),
  zakQz: request => adapter.calculateZakQz(instance, request),
  matrixQz: request => adapter.calculateVisnovskyQz(instance, request),
  dielectricTensor: request => adapter.calculateDielectricTensor(instance, request),
  lookup: (table, queries, cursor) => adapter.lookupTable(instance, table, queries, cursor),
}
const server = await createServer({ root: resolve(root, 'app'), configFile: false,
  server: { middlewareMode: true }, appType: 'custom' })
const directory = await mkdtemp(resolve(tmpdir(), 'remagx-native-terminal-'))
try {
  const { resolveChantlerTables } = await server.ssrLoadModule('/src/model/chantlerTables.ts')
  const { storedOpticalState } = await server.ssrLoadModule('/src/model/storedOpticalState.ts')
  const { createDefaultProject } = await server.ssrLoadModule('/src/model/defaults.ts')
  const { postprocessDatasetColumns } = await server.ssrLoadModule('/src/model/datasetPostprocessing.ts')
  const { calculateRealCurve } = await server.ssrLoadModule('/src/model/realCalculation.ts')
  const { parseOpticalTable } = await server.ssrLoadModule('/src/import/tables.ts')
  const { importAllFile } = await server.ssrLoadModule('/src/import/allFile.ts')
  const imported = importAllFile(await readFile(resolve(root, 'app/test/fixtures/Tut2.all'), 'utf8'), 'Tut2.all').project
  const dataset = imported.datasets[0]
  assert.ok(dataset)
  const base = createDefaultProject()
  base.calculation.automaticOpticalConstants = false
  base.calculation.roughnessModel = 'nevot-croce'
  base.calculation.postProcessing = { multiplyByQz4: false, divideByCos2ThetaSquared: false, fourierTransform: false }
  base.calculation.averaging = 0
  base.sample.multilayer.enabled = false
  base.scripts.enabled = false
  base.experiment.qzScan = { qzMin: 0.05, qzMax: 0.2, points: 13, useDatasetPoints: false, showAngle: false }
  base.experiment.resolution.energyFwhm = 0
  base.sample.layers[1].deltaMag = 2e-6
  base.sample.layers[1].betaMag = 4e-7
  base.sample.layers[1].magnetization = { gamma: 37, phi: 63 }
  const filename = resolve(directory, 'public-synthetic.json')
  let comparisons = 0, values = 0
  function run(args) {
    return spawnSync(executable, args, { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10000 })
  }
  async function compare(project, dichroic, tables = []) {
    const text = JSON.stringify(project)
    await writeFile(filename, text)
    const actual = run([dichroic ? '-dicrefl' : '-refl', filename])
    assert.equal(actual.status, 0, actual.stderr || String(actual.error))
    if (project.calculation.automaticOpticalConstants) {
      if (project.sample.mode === 'compound') assert.match(actual.stderr, /saved optical state retained/)
    } else assert.equal(actual.stderr, '')
    if (!dichroic && project.experiment.resolution.energyFwhm > 1e-6) {
      const warnings = actual.stderr.trim().split('\n')
      assert.equal(new Set(warnings).size, warnings.length, 'Repeated sampling warnings should be deduplicated')
    }
    if (tables.some(table => table.warnings.length)) {
      assert.match(actual.stderr, /malformed rows skipped/)
      assert.match(actual.stderr, /ignored extra columns/)
    }
    assert.equal(await readFile(filename, 'utf8'), text, 'Calculation changed its input')
    const qz = project.experiment.qzScan.useDatasetPoints
      ? project.datasets[project.activeDatasetIndex].columns.qz.map(value => value + project.datasets[project.activeDatasetIndex].qzShift)
      : Array.from({ length: project.experiment.qzScan.points }, (_, index) => index / (project.experiment.qzScan.points - 1) * project.experiment.qzScan.qzMax)
    // Supply the terminal's measured coordinates to the real web preparation.
    const reference = structuredClone(project)
    reference.datasets = [{ ...structuredClone(dataset), qzShift: 0, energyShift: 0, columns: { qz } }]
    reference.activeDatasetIndex = 0
    reference.experiment.qzScan.useDatasetPoints = true
    const broadened = !dichroic && project.experiment.resolution.energyFwhm > 1e-6
    if (!broadened) {
      reference.calculation.postProcessing = { multiplyByQz4: false, divideByCos2ThetaSquared: false, fourierTransform: false }
      reference.calculation.averaging = 0
    }
    const raw = calculateRealCurve(reference, resolveChantlerTables(reference, tables), engine, 'qz', dichroic ? 'dichroic' : 'monochromatic',
      project.sample.mode === 'element' ? storedOpticalState(reference) : undefined)
    const postProject = structuredClone(project)
    const selected = project.experiment.qzScan.useDatasetPoints ? project.datasets[project.activeDatasetIndex] : undefined
    postProject.experiment.energy = selected?.energy ?? 10
    postProject.experiment.polarization = selected?.polarization ?? {
      beam1: { sigma: { re: 1, im: 0 }, pi: { re: 0, im: 0 } },
      beam2: { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }, analyzer: 'none',
    }
    const expected = broadened ? { qz: raw.qz, reflectivity: raw.reflectivityPlus } : postprocessDatasetColumns(postProject, {
      qz, energy: selected?.columns.energy,
      ...(dichroic ? { reflectivityPlus: raw.reflectivityPlus, reflectivityMinus: raw.reflectivityMinus }
        : { reflectivity: raw.reflectivityPlus }),
    }, dichroic, (coordinates, reflectivity) => adapter.calculateFourier(instance, coordinates, reflectivity))
    const rows = actual.stdout.trim().split('\n').map(line => line.split(/\s+/).map(Number))
    assert.equal(rows.length, expected.qz.length)
    rows.forEach((row, index) => {
      assert.equal(row.length, dichroic ? 3 : 2)
      assert.equal(row[0], expected.qz[index], 'Coordinate round trip differs')
      const wanted = dichroic ? [expected.reflectivityPlus[index], expected.reflectivityMinus[index]] : [expected.reflectivity[index]]
      row.slice(1).forEach((value, column) => {
        assert.ok(Number.isFinite(value))
        assert.ok(Math.abs(value - wanted[column]) <= 1e-15 + 1e-10 * Math.abs(wanted[column]),
          `Native/WASM terminal difference at case ${comparisons}, point ${index}, column ${column}`)
        values++
      })
    })
    comparisons++
  }
  for (const algorithm of ['parratt', 'matrix', 'zak']) {
    for (const dichroic of [false, true]) {
      for (const fast of [false, true]) {
        for (const analyzer of ['none', 'sigma', 'pi']) {
          const project = structuredClone(base)
          project.calculation.algorithm = algorithm
          project.experiment.resolution.fastConvolution = fast
          project.experiment.resolution.angularFwhm = fast ? 0.001 : 0.0005
          project.experiment.polarization.analyzer = analyzer
          project.experiment.polarization.beam1 = { sigma: { re: 0.6, im: 0.2 }, pi: { re: -0.1, im: 0.7 } }
          project.experiment.polarization.beam2 = { sigma: { re: 0.3, im: -0.4 }, pi: { re: 0.5, im: 0.1 } }
          await compare(project, dichroic)
        }
      }
      const processed = structuredClone(base)
      processed.calculation.algorithm = algorithm
      processed.calculation.postProcessing.multiplyByQz4 = true
      processed.calculation.averaging = 2
      processed.calculation.tensorContribution = 'tetragonal'
      processed.calculation.magnetization.mode = 'none'
      processed.datasets = [{ ...structuredClone(dataset), qzShift: 0, columns: { qz: [0.01, 0.03, 0.06, 0.1, 0.2] } }]
      processed.activeDatasetIndex = 0
      processed.experiment.qzScan.useDatasetPoints = true
      await compare(processed, dichroic)
      const measured = structuredClone(base)
      measured.calculation.algorithm = algorithm
      measured.datasets = [{ ...structuredClone(dataset), qzShift: 5e-12, columns: { qz: [0.03, -0.01, 0.03, 0.01, 0.2] } }]
      measured.activeDatasetIndex = 0
      measured.experiment.qzScan.useDatasetPoints = true
      await compare(measured, dichroic)
      const generatedCorrection = structuredClone(base)
      generatedCorrection.calculation.algorithm = algorithm
      generatedCorrection.calculation.postProcessing.divideByCos2ThetaSquared = true
      // State beams deliberately differ from the terminal CDataSet defaults.
      generatedCorrection.experiment.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
      generatedCorrection.experiment.polarization.beam2 = { sigma: { re: 1, im: 0 }, pi: { re: 0, im: 0 } }
      await compare(generatedCorrection, dichroic)
      for (const withEnergyColumn of [false, true]) {
        const corrected = structuredClone(measured)
        corrected.datasets[0].energy = 700
        corrected.datasets[0].energyShift = 200 // Original terminal does not adapt eng.
        corrected.datasets[0].polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
        corrected.datasets[0].polarization.beam2 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
        if (withEnergyColumn) corrected.datasets[0].columns.energy = [500, 600, 700, 800, 900]
        corrected.calculation.postProcessing.divideByCos2ThetaSquared = true
        corrected.calculation.postProcessing.multiplyByQz4 = true
        corrected.calculation.averaging = 1
        await compare(corrected, dichroic)
        if (!dichroic) {
          corrected.calculation.postProcessing.fourierTransform = true
          await compare(corrected, false)
        }
      }
      if (!dichroic) {
        const transformed = structuredClone(generatedCorrection)
        transformed.calculation.postProcessing.fourierTransform = true
        await compare(transformed, false)
      }
      for (const pattern of ['3*(1)', '2*(1,2*(1))', '', '0*(1),1', '0,1,2', '1\0,2', '1)2', '1a']) {
        const multilayer = structuredClone(base)
        multilayer.calculation.algorithm = algorithm
        multilayer.sample.multilayer = { enabled: true, pattern }
        await compare(multilayer, dichroic)
      }
    }
  }
  for (const algorithm of ['parratt', 'matrix', 'zak']) for (const fast of [false, true]) {
    for (const width of [1e-6, 1.000001e-6, 10, 80]) {
      const project = structuredClone(base)
      project.calculation.algorithm = algorithm
      project.experiment.resolution.fastConvolution = fast
      project.experiment.resolution.angularFwhm = 0.001
      project.experiment.resolution.energyFwhm = width
      project.calculation.postProcessing.multiplyByQz4 = true
      project.calculation.postProcessing.divideByCos2ThetaSquared = true
      project.calculation.averaging = 1
      project.datasets = [{ ...structuredClone(dataset), qzShift: 0, energyShift: 50,
        columns: { qz: [-0.01, 0.02, 0.08, 0.05], energy: [100,200,300,400] } }]
      project.activeDatasetIndex = 0
      project.experiment.qzScan.useDatasetPoints = true
      await compare(project, false)
    }
    const dichroic = structuredClone(base)
    dichroic.calculation.algorithm = algorithm
    dichroic.experiment.resolution.fastConvolution = fast
    dichroic.experiment.resolution.energyFwhm = dichroic.experiment.energy * 2
    await compare(dichroic, true) // no energy sampling in this original entry point
  }
  for (const scope of ['global', 'local']) for (const algorithm of ['parratt', 'matrix', 'zak']) {
    for (const dichroic of [false, true]) {
      const project = structuredClone(base)
      project.calculation.algorithm = algorithm
      project.calculation.roughnessModel = 'segmentation'
      project.calculation.segmentation = { ...project.calculation.segmentation, scope, minThickness: 2, maxThickness: 8, gradientScale: 1 }
      project.calculation.magnetization.mode = 'add'
      project.calculation.epsilon = 1e-12
      project.sample.layers = [project.sample.layers[0], project.sample.layers[1], project.sample.layers.at(-1)]
      project.sample.layers[0].roughness = 11
      project.sample.layers[1].roughness = 13
      project.sample.layers[1].thickness = 12
      project.sample.multilayer = { enabled: true, pattern: '2*(1)' }
      project.datasets = [{ ...structuredClone(dataset), qzShift: 0, columns: { qz: [0.01, 0.02, 0.05, 0.1] } }]
      project.activeDatasetIndex = 0
      project.experiment.qzScan.useDatasetPoints = true
      await compare(project, dichroic)
      for (const combination of ['sum', 'product']) {
        const profiled = structuredClone(project)
        profiled.calculation.magnetization.mode = 'profile'
        profiled.calculation.profileCombination = combination
        const amplitude = combination === 'sum' ? 0.000003 : 0.3
        const profile = { center: 11, width: 12, deltaAmplitude: amplitude, betaAmplitude: amplitude / 3,
          boundToLayer: null, amplitudeCoupledTo: 999, widthCoupledTo: 999, spline: { enabled: false, points: [] } }
        profiled.sample.depthProfileFunctions = [profile, { ...profile, boundToLayer: 1,
          spline: { enabled: true, points: [-1000,-300,-11,37,300,1000].map((z, index) =>
            ({ z, value: [0,0,0.5,0.8,0,0][index] })) } },
          { ...profile, deltaAmplitude: 0, betaAmplitude: 0, boundToLayer: 999 }]
        await compare(profiled, dichroic)
        if (scope === 'global' && algorithm === 'parratt' && !dichroic && combination === 'product') {
          profiled.experiment.resolution.energyFwhm = 10
          await compare(profiled, false)
        }
      }
      if (scope === 'global' && algorithm === 'matrix' && !dichroic) {
        project.experiment.resolution.energyFwhm = 10
        await compare(project, false)
      }
    }
  }
  const tensor = Array.from(adapter.calculateDielectricTensor(instance, {
    layer: [50, 1, 0.002, 0.0002, 0.00003, 0.00001, 37, 63], tensor: 0, magnetic: 1,
  }).values)
  for (const variant of ['scalar', 'magnetic', 'tensor', 'missing', 'outside', 'missing-no-tensor', 'missing-isotropic-tensor', 'malformed', 'empty']) {
    const tables = []
    const name = `native-${variant}`
    if (!variant.startsWith('missing')) {
      const content = variant === 'empty' ? '# empty public table\n' : variant === 'malformed' ? 'bad row\n700 .002 .0002 ignored\n900 .004 .0004\n' : variant === 'outside' ? '100 0.002 0.0002\n200 0.004 0.0004\n'
        : '# unordered public synthetic input\n900 0.004 0.0004\n700 0.002 0.0002\n'
      await writeFile(resolve(directory, `${name}.db`), content)
      tables.push(parseOpticalTable(content, `${name}.db`))
    }
    if (variant === 'magnetic' || variant === 'tensor') {
      const content = '700 0.00002 0.00001\n900 0.00004 0.00002\n'
      await writeFile(resolve(directory, `${name}.m`), content)
      tables.push(parseOpticalTable(content, `${name}.m`))
    }
    if (variant === 'tensor') {
      const content = [700, 900].map(energy => `${energy} ${tensor.join(' ')}`).join('\n')
      await writeFile(resolve(directory, `${name}.e`), content)
      tables.push(parseOpticalTable(content, `${name}.e`))
    }
    for (const algorithm of ['parratt', 'matrix', 'zak']) for (const dichroic of [false, true]) {
      const project = structuredClone(base)
      project.calculation.algorithm = algorithm
      project.calculation.automaticOpticalConstants = true
      project.calculation.magnetization.mode = 'add'
      project.calculation.epsilon = 1e-12
      project.experiment.energy = 800
      project.sample.layers.forEach(layer => { layer.opticalTable = '' })
      project.sample.layers[1].opticalTable = name
      if (variant !== 'missing-no-tensor') project.sample.layers[1].dielectricTensor = { values: tensor, anisotropic: variant !== 'missing-isotropic-tensor' }
      project.sample.multilayer = { enabled: true, pattern: '2*(1)' }
      project.datasets = [{ ...structuredClone(dataset), qzShift: 0, columns: { qz: [0.01, 0.02, 0.04, 0.08] } }]
      project.activeDatasetIndex = 0
      project.experiment.qzScan.useDatasetPoints = true
      await compare(project, dichroic, tables)
      if (variant === 'tensor' && algorithm === 'matrix' && !dichroic) {
        const segmented = structuredClone(project)
        segmented.sample.layers = [segmented.sample.layers[0], segmented.sample.layers[1], segmented.sample.layers.at(-1)]
        segmented.sample.layers[0].roughness = 11
        segmented.sample.layers[1].roughness = 13
        segmented.sample.layers[1].thickness = 12
        for (const layer of segmented.sample.layers) {
          const prepared = adapter.calculateDielectricTensor(instance, {
            layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag,
              layer.magnetization.gamma, layer.magnetization.phi], tensor: 0, magnetic: 1,
          })
          layer.dielectricTensor = { values: Array.from(prepared.values), anisotropic: prepared.anisotropic }
        }
        segmented.calculation.roughnessModel = 'segmentation'
        segmented.calculation.segmentation = { ...segmented.calculation.segmentation,
          scope: 'global', minThickness: 2, maxThickness: 8, gradientScale: 1 }
        await compare(segmented, false, tables)
      }
      if (!dichroic) {
        project.experiment.resolution.energyFwhm = 75
        project.calculation.postProcessing.multiplyByQz4 = true
        project.calculation.averaging = 1
        await compare(project, false, tables)
      }
    }
  }
  // At zero incidence the existing tetragonal/magnetization-off kernel can
  // reject a numerical singularity. Preserve and verify that failure, not a
  // fabricated zero intensity or an altered coordinate grid.
  let singularities = 0
  for (const algorithm of ['parratt', 'matrix', 'zak']) {
    const project = structuredClone(base)
    project.calculation.algorithm = algorithm
    project.calculation.tensorContribution = 'tetragonal'
    project.calculation.magnetization.mode = 'none'
    await writeFile(filename, JSON.stringify(project))
    const actual = run(['-refl', filename])
    const reference = structuredClone(project)
    reference.datasets = [{ ...structuredClone(dataset), qzShift: 0, columns: {
      qz: Array.from({ length: 13 }, (_, index) => index / 12 * 0.2),
    } }]
    reference.activeDatasetIndex = 0
    reference.experiment.qzScan.useDatasetPoints = true
    let failure
    try { calculateRealCurve(reference, [], engine, 'qz', 'monochromatic') } catch (error) { failure = error }
    if (failure) {
      assert.equal(failure.status, 2, 'Only the observed native numerical status is expected')
      assert.equal(actual.status, 1)
      assert.equal(actual.stdout, '')
      assert.match(actual.stderr, /Numerical calculation failed/)
      singularities++
    } else assert.equal(actual.status, 0)
  }
  assert.ok(singularities > 0, 'The observed zero-incidence singularity must remain covered')
  // Element2Material: unequal profile extents, zero roughness, tensor retention,
  // last-sample replacement within tolerance, batch boundaries and energy scaling.
  const elementBase = structuredClone(base)
  elementBase.sample.mode = 'element'
  elementBase.experiment.energy = 8000
  elementBase.calculation.segmentation.minThickness = 0.25
  elementBase.calculation.segmentation.tolerance = 1e-9
  elementBase.calculation.magnetization.mode = 'add'
  elementBase.calculation.magnetization.direction = { gamma: 47, phi: 61 }
  elementBase.sample.elementProfiles = [
    { element: 'Fe', f1: 25, f2: 2, f1Mag: 0.4, f2Mag: 0.1,
      slabs: [{ thickness: 900, density: 0.08, roughness: 3 },
        { thickness: 27, density: 0.09, roughness: 2 }, { thickness: 800, density: 0, roughness: 7 }] },
    { element: 'O', f1: 7, f2: 0.1, f1Mag: 0.03, f2Mag: 0.01,
      slabs: [{ thickness: 100, density: 0.02, roughness: 0 },
        { thickness: 35, density: 0.04, roughness: 5 }, { thickness: 0, density: 0, roughness: 0 }] },
  ]
  for (const profile of elementBase.sample.elementProfiles) profile.scatteringTensor = Array.from(adapter.calculateScatteringTensor(instance, {
    factors: [profile.f1, profile.f2, profile.f1Mag, profile.f2Mag], gamma: 47, phi: 61,
  }))
  for (const algorithm of ['parratt', 'matrix', 'zak']) for (const dichroic of [false, true]) {
    for (const variant of ['base', 'coarse', 'stored-tensor', 'broadening']) {
      const project = structuredClone(elementBase)
      project.calculation.algorithm = algorithm
      if (variant === 'coarse') {
        project.calculation.segmentation.minThickness = 0.9
        project.calculation.segmentation.tolerance = 1e-7
        project.calculation.roughnessModel = 'segmentation'
        project.sample.multilayer = { enabled: true, pattern: 'invalid' } // ignored in element mode
      }
      if (variant === 'stored-tensor') {
        project.sample.elementProfiles[0].scatteringTensor[2] += 0.03
        delete project.sample.elementProfiles[1].scatteringTensor
      }
      if (variant === 'broadening') {
        project.experiment.resolution.energyFwhm = 15
        project.experiment.resolution.angularFwhm = 0.01
      }
      await compare(project, dichroic)
    }
  }
  for (const variant of ['scalar', 'magnetic', 'missing', 'outside', 'empty', 'malformed', 'partial-range']) {
    const name = `native-element-${variant}`
    const tables = []
    if (variant !== 'missing') {
      const content = variant === 'empty' ? '# empty\n' : variant === 'outside' ? '100 20 1\n200 24 2\n'
        : variant === 'malformed' ? 'bad row\n7900 20 1 ignored\n8100 24 2\n'
          : variant === 'partial-range' ? '7990 20 1\n8010 24 2\n' : '8100 24 2\n7900 20 1\n'
      await writeFile(resolve(directory, `${name}.ff`), content)
      tables.push(parseOpticalTable(content, `${name}.ff`))
    }
    if (variant === 'magnetic' || variant === 'partial-range') {
      const content = '7900 .3 .1\n8100 .5 .2\n'
      await writeFile(resolve(directory, `${name}.ffm`), content)
      tables.push(parseOpticalTable(content, `${name}.ffm`))
    }
    for (const algorithm of ['parratt', 'matrix', 'zak']) for (const dichroic of [false, true]) {
      const project = structuredClone(elementBase)
      project.calculation.algorithm = algorithm
      project.calculation.automaticOpticalConstants = true
      project.sample.elementProfiles[0].element = name
      // Missing second profile retains its supplied tensor and factors.
      project.sample.elementProfiles[1].element = 'native-unavailable-element'
      if (variant === 'partial-range') project.experiment.resolution.energyFwhm = 15
      await compare(project, dichroic, tables)
    }
  }
  for (const algorithm of ['parratt', 'matrix', 'zak']) for (const symbol of ['Fe', 'U', 'Ti', 'Tl', 'fe']) {
    const project = structuredClone(elementBase)
    project.calculation.algorithm = algorithm
    project.calculation.automaticOpticalConstants = true
    project.calculation.useChantlerDatabase = true
    project.sample.elementProfiles[0].element = symbol
    // Positive measured qz isolates table preparation from known zero-incidence singularities.
    project.datasets = [{ ...structuredClone(dataset), qzShift: 0, columns: { qz: [0.01,0.03,0.06,0.1] } }]
    project.activeDatasetIndex = 0
    project.experiment.qzScan.useDatasetPoints = true
    await compare(project, true)
    if (symbol === 'Fe') {
      project.experiment.resolution.energyFwhm = 15
      await compare(project, false)
      for (const content of ['# empty\n', '100 20 1\n200 22 2\n', '7900 20 1\n8100 24 2\n']) {
        await writeFile(resolve(directory, 'Fe.ff'), content)
        const magneticContent = '7900 .3 .1\n8100 .5 .2\n'
        await writeFile(resolve(directory, 'Fe.ffm'), magneticContent)
        await compare(project, false, [parseOpticalTable(content, 'Fe.ff'), parseOpticalTable(magneticContent, 'Fe.ffm')])
      }
      await rm(resolve(directory, 'Fe.ff')); await rm(resolve(directory, 'Fe.ffm'))
      project.calculation.useChantlerDatabase = false
      await compare(project, false)
    }
  }
  const fullName = 'native-element-full'
  const scalarText = '7900 20 1\n8100 24 2\n'
  const fullText = `8000 ${Array(18).fill(0.1).join(' ')}\n`
  await writeFile(resolve(directory, `${fullName}.ff`), scalarText)
  await writeFile(resolve(directory, `${fullName}.F`), fullText)
  const full = structuredClone(elementBase)
  full.calculation.automaticOpticalConstants = true
  full.sample.elementProfiles[0].element = fullName
  await writeFile(filename, JSON.stringify(full))
  const fullFailure = run(['-refl', filename])
  assert.equal(fullFailure.status, 1)
  assert.equal(fullFailure.stdout, '')
  assert.match(fullFailure.stderr, /element-assignment decision/)
  full.experiment.energy = 8200 // skipped primary must not evaluate the .F assignment
  await compare(full, false, [parseOpticalTable(scalarText, `${fullName}.ff`), parseOpticalTable(fullText, `${fullName}.F`)])
  full.calculation.automaticOpticalConstants = false
  full.experiment.energy = 8000
  await compare(full, false) // manual calculation never opens either table
  for (const change of [
    project => { project.calculation.segmentation.minThickness = 0 },
    project => { project.calculation.segmentation.minThickness = 1e-9 },
    project => { project.sample.elementProfiles = [] },
    project => { project.sample.elementProfiles[0].slabs = [] },
  ]) {
    const project = structuredClone(elementBase); change(project)
    await writeFile(filename, JSON.stringify(project))
    const failure = run(['-refl', filename])
    assert.equal(failure.status, 1, failure.stderr)
    assert.equal(failure.stdout, '')
  }
  const legacyFilename = resolve(directory, 'public-terminal.ALL')
  for (const algorithm of [0, 1, 2]) {
    const content = `fileversion=1\nlayerversion=3\nlayer=0\nlayer_delta=.00002\nlayer_beta=.000003\n` +
      `layer=1\nlayer_d=24\nlayer_sigma=2\nlayer_delta=.00001\nlayer_beta=.000001\n` +
      `layer_ddelta=.0000002\nlayer_dbeta=.0000001\nlayer=2\nenergy=8000\ndisablescript=1\n` +
      `magnetizationmode=1\nalgorithm=${algorithm}\nnumberofpoints=9\nqzmax=.2\nfuture_terminal_key=1\n`
    const project = importAllFile(content, 'public-terminal.ALL').project
    for (const dichroic of [false, true]) {
      await compare(project, dichroic)
      const command = dichroic ? '-dicrefl' : '-refl'
      const expected = run([command, filename])
      await writeFile(legacyFilename, content)
      const actual = run([command, legacyFilename])
      assert.equal(actual.status, 0, actual.stderr)
      assert.equal(actual.stdout, expected.stdout)
      assert.match(actual.stderr, /Import ignored key future_terminal_key/)
      assert.equal(await readFile(legacyFilename, 'utf8'), content)
    }
  }
  for (const content of ['fileversion=2\n', 'layer=0\nlayer_d=-1\n',
    'scriptline=error("public diagnostic")\n']) {
    await writeFile(legacyFilename, content)
    const actual = run(['-refl', legacyFilename])
    assert.equal(actual.status, 1)
    assert.equal(actual.stdout, '')
  }
  const invalid = [
    project => { project.sample.mode = 'element' },
    project => { project.sample.multilayer = { enabled: true, pattern: '2*(1' } },
    project => { project.sample.multilayer = { enabled: true, pattern: '100000*(1)' } },
    project => { project.sample.multilayer = { enabled: true, pattern: '0*(999)' } },
    project => { project.calculation.roughnessModel = 'segmentation'; project.calculation.segmentation.minThickness = 0 },
    project => {
      project.calculation.roughnessModel = 'segmentation'; project.calculation.magnetization.mode = 'profile'
      project.sample.depthProfileFunctions = [{ center: 0, width: 2, deltaAmplitude: 0.00001, betaAmplitude: 0,
        boundToLayer: 999, amplitudeCoupledTo: null, widthCoupledTo: null, spline: { enabled: false, points: [] } }]
    },
    project => {
      project.calculation.roughnessModel = 'segmentation'; project.calculation.magnetization.mode = 'profile'
      project.calculation.segmentation.minThickness = 2; project.calculation.segmentation.maxThickness = 2
      project.sample.layers[0].roughness = 0
      project.sample.depthProfileFunctions = [{ center: 0, width: 2, deltaAmplitude: 0.00001, betaAmplitude: 0,
        boundToLayer: null, amplitudeCoupledTo: null, widthCoupledTo: null,
        spline: { enabled: true, points: [-30,-28,-26,-24].map(z => ({ z, value: 1 })) } }]
    },
    project => { project.calculation.roughnessModel = 'segmentation'; project.calculation.segmentation.minThickness = 100000; project.calculation.segmentation.maxThickness = 100000 },
    project => { project.scripts.enabled = true; project.scripts.beforeCalculation = 'error("public script failure")' },
    project => { project.experiment.scattering = 'transmission' },
    project => { project.calculation.postProcessing.fourierTransform = true; project.experiment.qzScan.qzMax = 0 },
    project => { project.experiment.resolution.energyFwhm = project.experiment.energy },
    project => { project.experiment.resolution.energyFwhm = 1; project.calculation.postProcessing.fourierTransform = true },
    project => { project.experiment.qzScan.points = 1000001 },
    project => { project.experiment.qzScan.qzMax = 1e100 },
    project => { project.sample.layers[1].beta = 1e200 },
    project => { project.experiment.qzScan.useDatasetPoints = true; project.activeDatasetIndex = null },
    project => { project.sample.layers[0].thickness = -1 },
  ]
  for (const mutate of invalid) {
    const project = structuredClone(base); mutate(project)
    await writeFile(filename, JSON.stringify(project))
    const result = run(['-refl', filename])
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '', 'Failure emitted partial scientific output')
    assert.ok(result.stderr.length > 0)
    if (project.scripts.enabled) assert.match(result.stderr,
      /Lua execution failed: BeforeCalculation:1: public script failure|built without Lua support/)
  }
  for (const command of ['-map', '--unknown']) {
    const result = run([command, filename])
    assert.equal(result.status, 2); assert.equal(result.stdout, '')
  }
  const dichroicFourier = structuredClone(base)
  dichroicFourier.calculation.postProcessing.fourierTransform = true
  await writeFile(filename, JSON.stringify(dichroicFourier))
  const deferredFourier = run(['-dicrefl', filename])
  assert.equal(deferredFourier.status, 1); assert.equal(deferredFourier.stdout, '')
  assert.match(deferredFourier.stderr, /Dichroic Fourier/)
  const invalidTable = structuredClone(base)
  invalidTable.calculation.automaticOpticalConstants = true
  invalidTable.sample.layers[1].opticalTable = 'directory-input'
  await mkdir(resolve(directory, 'directory-input.db'))
  await writeFile(filename, JSON.stringify(invalidTable))
  const tableFailure = run(['-refl', filename])
  assert.equal(tableFailure.status, 1); assert.equal(tableFailure.stdout, '')
  assert.match(tableFailure.stderr, /not a regular file/)
  invalidTable.calculation.automaticOpticalConstants = false
  await compare(invalidTable, false) // manual mode must not inspect table files
  const missing = run(['-refl', resolve(directory, 'missing.json')])
  assert.equal(missing.status, 1); assert.equal(missing.stdout, '')
  assert.equal(run(['-v']).status, 0)
  assert.equal(run(['--help']).status, 0)
  await compare(base, false) // successful recovery after rejected work
  console.log(`Native terminal: ${comparisons} actual-WASM comparisons (${values} values), explicit failures, input preservation and recovery passed.`)
} finally {
  await server.close()
  await rm(directory, { recursive: true, force: true })
}
