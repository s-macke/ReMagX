import { prepareCompoundQzRequest } from '../../src/model/parrattRequest'
import { postprocessParrattResult } from '../../src/model/parrattResult'
import { prepareSegmentedCompoundStack } from '../../src/model/segmentedCompoundStack'
import { applySegmentedMagneticProfiles, type MagneticProfileEngine } from '../../src/model/segmentedMagneticProfiles'
import { prepareSegmentedLayers } from '../../src/model/segmentedLayers'
import type { PreparedCompoundLayer } from '../../src/model/compoundLayers'
import { refreshElementOptics } from '../../src/model/refreshElementOptics'
import { createElementDensitySampler } from '../../src/model/elementDensity'
import { prepareElementLayers } from '../../src/model/elementLayers'
import { HC_EV_ANGSTROM } from '../../src/model/units'
import { createBeforeCalculation } from '../../src/compute/lua/beforeCalculation'
import { calculatePreparedScriptReflectivity, prepareScriptReflectivityInput } from '../../src/model/scriptReflectivity'
import { calculateRealCurve, type RealCalculationEngine } from '../../src/model/realCalculation'
import { createLayer } from '../../src/model/defaults'
import { runProjectHook } from '../../src/compute/lua/projectHook'
import { createScriptOptics } from '../../src/model/scriptOptics'
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
    const messages: string[] = []
    session.installOutput(message => messages.push(message))
    session.execute('print("energy=", 700.0); write("small=", 0.000012345678901234567)', 'Default')
    const outputPassed = messages.join('|') === 'energy=700|small=1.2345678901235e-05'
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
    const numerical: RealCalculationEngine = {
      calculate: request => adapter.calculateParrattQz(instance, request),
      matrixQz: request => adapter.calculateVisnovskyQz(instance, request),
      zakQz: request => adapter.calculateZakQz(instance, request),
      scatteringTensor: request => adapter.calculateScatteringTensor(instance, request),
      dielectricTensor: request => adapter.calculateDielectricTensor(instance, request),
      convolveFastQz: (qz, values, width) => adapter.convolveFastQz(instance, qz, values, width),
      energyScan: request => adapter.calculateParrattEnergyScan(instance, request),
      matrixEnergy: request => adapter.calculateVisnovskyEnergyScan(instance, request),
      zakEnergy: request => adapter.calculateZakEnergyScan(instance, request),
      lookup: (table, energy, cursor) => adapter.lookupTable(instance, table, energy, cursor),
    }
    const segmentationUrl = new URL('./segmentation.mjs', self.location.href).href
    const segmentation = await import(/* @vite-ignore */ segmentationUrl)
    const segmentationLayers: PreparedCompoundLayer[] = [[999, 11, 1, 2, 3, 4, 12, 34],
      [7, 12, 1, 2, 3, 4, 56, 78], [999, 100, 1, 2, 3, 4, 0, 0]]
    const segmentationBefore = JSON.stringify(segmentationLayers)
    for (const scope of ['global', 'local'] as const) for (const matrix of [false, true]) {
      const generated = prepareSegmentedLayers(segmentationLayers,
        { ...createDefaultProject().calculation.segmentation, scope, minThickness: 10, maxThickness: 10 },
        Array(1001).fill(0), {
          sample: request => segmentation.calculateSegmentedOptics(instance, request),
          subdivide: request => segmentation.calculateAdaptiveSegments(instance, request),
        }, matrix ? segmentationLayers.map((_, index) => ({ values: new Float64Array(18).fill(2), anisotropic: index === 1 })) : undefined)
      if (generated.layers.length !== 8 || JSON.stringify(generated.positions) !== '[-28,-18,-8,2,12,22,32,42]') {
        throw new Error('Prepared segmentation depth geometry failed')
      }
      generated.layers.forEach((layer, index) => {
        const expected = [index ? 10 : 0, 0, 1, 2, 3, 4, 90, 90]
        if (layer.some((value, component) => Math.abs(value - expected[component]) > 1e-15 + 1e-10 * Math.abs(expected[component]))) {
          throw new Error('Prepared segmentation scalar metadata failed')
        }
        const tensor = generated.dielectricTensors[index]
        if (!matrix) { if (tensor !== null) throw new Error('Unexpected scalar segmentation tensor'); return }
        const expectedTensor = scope === 'local' && index > 0 ? 2 * (8 + index) : 2
        if (!tensor || tensor.anisotropic !== (index > 0 && index < 7) ||
            tensor.values.some(value => Math.abs(value - expectedTensor) > 1e-15 + 1e-10 * Math.abs(expectedTensor))) {
          throw new Error('Prepared segmentation tensor state/classification failed')
        }
      })
      const profiles = [null, 1, 0, 2].map((boundToLayer, index) => ({
        center: 3, width: 9, deltaAmplitude: 0.2 + index * 0.1, betaAmplitude: -0.1 - index * 0.2,
        boundToLayer, amplitudeCoupledTo: 0, widthCoupledTo: 0,
        spline: { enabled: index === 1, points: [-100, -80, 80, 100].map(z => ({ z, value: 0.6 })) },
      }))
      const generatedBefore = JSON.stringify(generated)
      const profilesBefore = JSON.stringify(profiles)
      const profileEngine: MagneticProfileEngine = {
        density: request => adapter.calculateLayerDensity(instance, request),
        apply: request => adapter.applyMagneticProfiles(instance, request),
      }
      for (const additive of [true, false]) {
        const applied = applySegmentedMagneticProfiles(generated.layers, generated.positions,
          [0, 7, 7], segmentationLayers.map(layer => layer[1]), profiles, additive, Array(1001).fill(0), profileEngine)
        const stackProject = createDefaultProject()
        stackProject.sample.layers = segmentationLayers.map(row => createLayer({ thickness: row[0], roughness: row[1],
          delta: row[2], beta: row[3], deltaMag: row[4], betaMag: row[5], magnetization: { gamma: row[6], phi: row[7] } }))
        stackProject.sample.multilayer.enabled = false
        stackProject.sample.depthProfileFunctions = profiles
        stackProject.calculation.algorithm = matrix ? 'matrix' : 'parratt'
        stackProject.calculation.roughnessModel = 'segmentation'
        stackProject.calculation.magnetization.mode = 'profile'
        stackProject.calculation.profileCombination = additive ? 'sum' : 'product'
        stackProject.calculation.segmentation = { ...stackProject.calculation.segmentation, scope, minThickness: 10, maxThickness: 10 }
        const combined = prepareSegmentedCompoundStack(stackProject, [0, 7, 7], Array(1001).fill(0), {
          ...profileEngine,
          sample: request => segmentation.calculateSegmentedOptics(instance, request),
          subdivide: request => segmentation.calculateAdaptiveSegments(instance, request),
        }, matrix ? segmentationLayers.map((_, index) => ({ values: new Float64Array(18).fill(2), anisotropic: index === 1 })) : undefined)
        if (JSON.stringify(combined.layers) !== JSON.stringify(applied) ||
            JSON.stringify(combined.dielectricTensors) !== JSON.stringify(generated.dielectricTensors)) {
          throw new Error('Combined compound stack preparation differs from staged application')
        }
        applied.forEach((layer, index) => {
          const expected = generated.layers[index].slice()
          if (index > 0) {
            const midpoint = (generated.positions[index - 1] + generated.positions[index]) * 0.5
            profiles.forEach((profile, profileIndex) => {
              // Controlled zero lookup: interior overlap is 1/4, outer media 1/2.
              const weight = [1, 0.25, 0.5, 0.5][profileIndex]
              const shape = profileIndex === 1 ? 0.6 : Math.exp(-((midpoint - 3) ** 2) / 2 / 81)
              for (const [component, amplitude] of [[4, profile.deltaAmplitude], [5, profile.betaAmplitude]]) {
                expected[component] += additive ? weight * amplitude * shape : weight * expected[component] * amplitude * shape
              }
            })
          }
          if (layer.some((value, component) => Math.abs(value - expected[component]) > 1e-15 + 1e-10 * Math.abs(expected[component]))) {
            throw new Error('Prepared magnetic-profile WASM composition failed')
          }
        })
      }
      let rejected = false
      try {
        applySegmentedMagneticProfiles(generated.layers, generated.positions, [0, 7, 7], [11, 12, 100],
          [{ ...profiles[0], boundToLayer: 3 }], true, Array(1001).fill(0), profileEngine)
      } catch (error) { rejected = error instanceof Error && error.message.includes('outside the original layer stack') }
      let endpointRejected = false
      try {
        applySegmentedMagneticProfiles(generated.layers, generated.positions, [0, 7, 7], [11, 12, 100],
          [{ ...profiles[0], spline: { enabled: true, points: [-100, -23, 80, 100].map(z => ({ z, value: 1 })) } }],
          true, Array(1001).fill(0), profileEngine)
      } catch { endpointRejected = true }
      const recovered = applySegmentedMagneticProfiles(generated.layers, generated.positions, [0, 7, 7], [11, 12, 100],
        profiles, true, Array(1001).fill(0), profileEngine)
      if (!endpointRejected || !recovered.flat().every(Number.isFinite)) throw new Error('Magnetic-profile native-error recovery failed')
      if (!rejected || JSON.stringify(generated) !== generatedBefore || JSON.stringify(profiles) !== profilesBefore) {
        throw new Error('Magnetic-profile binding failure or input isolation failed')
      }

    }
    const preparedMagneticProfilesPassed = true
    const preparedSegmentationPassed = JSON.stringify(segmentationLayers) === segmentationBefore
    const segmentedNumerical: RealCalculationEngine = { ...numerical, segmentation: {
      errorSamples: Array(1001).fill(0),
      sample: request => segmentation.calculateSegmentedOptics(instance, request),
      subdivide: request => segmentation.calculateAdaptiveSegments(instance, request),
      density: request => adapter.calculateLayerDensity(instance, request),
      apply: request => adapter.applyMagneticProfiles(instance, request),
    } }
    for (const algorithm of ['parratt', 'zak', 'matrix'] as const) for (const scope of ['local', 'global'] as const)
      for (const combination of ['sum', 'product'] as const) for (const mode of ['monochromatic', 'dichroic'] as const) {
        const project = createDefaultProject()
        project.sample.layers = [createLayer({ delta: .01, beta: .001 }), createLayer({ thickness: 7, delta: .008, beta: .002 }), createLayer()]
        project.sample.multilayer.enabled = false
        project.sample.depthProfileFunctions = [{ center: 2, width: 5, deltaAmplitude: 1e-6, betaAmplitude: 2e-7,
          boundToLayer: 1, amplitudeCoupledTo: null, widthCoupledTo: null, spline: { enabled: false, points: [] } }]
        project.calculation.algorithm = algorithm
        project.calculation.automaticOpticalConstants = false
        project.calculation.roughnessModel = 'segmentation'
        project.calculation.magnetization.mode = 'profile'
        project.calculation.profileCombination = combination
        project.calculation.segmentation = { ...project.calculation.segmentation, scope, minThickness: 10, maxThickness: 10 }
        project.experiment.qzScan = { qzMin: .01, qzMax: .04, points: 4, useDatasetPoints: false }
        project.experiment.resolution.angularFwhm = .0001
        project.experiment.resolution.fastConvolution = combination === 'product'
        const tensors = algorithm === 'matrix' ? project.sample.layers.map(layer => numerical.dielectricTensor({
          layer: [layer.thickness, layer.roughness, layer.delta, layer.beta, layer.deltaMag, layer.betaMag, layer.magnetization.gamma, layer.magnetization.phi],
          tensor: 0, magnetic: 1,
        })) : undefined
        const expected = prepareSegmentedCompoundStack(project, [0, 7, 7], segmentedNumerical.segmentation!.errorSamples,
          segmentedNumerical.segmentation!, tensors)
        const request = prepareCompoundQzRequest(project, mode, undefined, expected.layers)
        const raw = algorithm === 'matrix' ? numerical.matrixQz({ ...request, epsilon: project.calculation.epsilon,
          layers: expected.layers.map((layer, index) => ({ values: [layer[0], layer[1], 1 - layer[2], layer[3], ...expected.dielectricTensors[index]!.values],
            anisotropic: expected.dielectricTensors[index]!.anisotropic ? 1 : 0 })) })
          : algorithm === 'zak' ? numerical.zakQz(request) : numerical.calculate(request)
        const reference = postprocessParrattResult(project, request.qz, raw, mode)
        const before = JSON.stringify(project)
        const actual = calculateRealCurve(project, [], segmentedNumerical, 'qz', mode)
        for (const column of ['reflectivityPlus', 'reflectivityMinus', 'asymmetry'] as const) {
          if (actual[column].length !== reference[column].length || actual[column].some((value, index) => !Number.isFinite(value) || !Number.isFinite(reference[column][index]) || Math.abs(value - reference[column][index]) > 1e-15 + 1e-10 * Math.abs(reference[column][index]))) {
            throw new Error('Segmented qz routing differs from prepared-stack WASM calculation')
          }
        }
        if (JSON.stringify(project) !== before || actual.opticalState.layers.length !== 3 || JSON.stringify(actual.opticalState.layerDepths) !== '[0,7,7]') {
          throw new Error('Segmented qz routing changed stored project state')
        }
      }
    const segmentedQzPassed = true
    for (const algorithm of ['parratt', 'zak', 'matrix'] as const) for (const scope of ['local', 'global'] as const)
      for (const mode of ['monochromatic', 'dichroic'] as const) {
        const project = createDefaultProject()
        project.sample.layers = [createLayer({ opticalTable: 'substrate', roughness: 20 }),
          createLayer({ opticalTable: 'film', thickness: 7, roughness: 20 }), createLayer({ opticalTable: 'air' })]
        project.sample.multilayer.enabled = false
        project.sample.depthProfileFunctions = [{ center: 2, width: 5, deltaAmplitude: 1e-6, betaAmplitude: 2e-7,
          boundToLayer: 1, amplitudeCoupledTo: null, widthCoupledTo: null, spline: { enabled: false, points: [] } }]
        project.calculation.algorithm = algorithm
        project.calculation.automaticOpticalConstants = false
        project.calculation.roughnessModel = 'segmentation'
        project.calculation.magnetization.mode = 'profile'
        project.calculation.profileCombination = mode === 'monochromatic' ? 'sum' : 'product'
        project.calculation.segmentation = { ...project.calculation.segmentation, scope, minThickness: 10, maxThickness: 10 }
        project.experiment.energy = 640
        project.experiment.qzScan.useDatasetPoints = true
        project.experiment.resolution.angularFwhm = .0001
        project.experiment.resolution.energyFwhm = .75
        project.experiment.resolution.fastConvolution = false
        const energies = [640, 900, 660, 640], coordinates = [.02, .03, .04, .02]
        project.datasets = [{ title: '', comment: '', sourceFile: '', active: true, errorWeight: 1, energy: 640, energyShift: 0, qzShift: 0,
          angularResolution: 0, intensityScale: 1, intensityOffset: 0, polarization: project.experiment.polarization,
          columns: { energy: energies, qz: coordinates, reflectivity: [1, 1, 1, 1] } }]
        project.activeDatasetIndex = 0
        project.scripts.enabled = true
        project.scripts.beforeCalculation = 'thickness[1] = (energy - 600) * 2'
        const scanTables: OpticalTable[] = ['substrate', 'film', 'air'].map((name, index) => ({ name, kind: 'db', energy: [600, 700],
          columns: index === 2 ? [[0, 0], [0, 0]] : [[.01 - index * .002, .012 - index * .002], [.001, .002]], warnings: [] }))
        const sliceCounts: number[] = []
        const scanEngine: RealCalculationEngine = { ...segmentedNumerical, segmentation: { ...segmentedNumerical.segmentation!,
          subdivide: request => { const result = segmentation.calculateAdaptiveSegments(instance, request); sliceCounts.push(result.positions.length); return result },
        } }
        const before = JSON.stringify(project)
        const scanSession = await runtime.createSession()
        let actual
        try { actual = calculateRealCurve(project, scanTables, scanEngine, 'energy', mode, undefined,
          createBeforeCalculation(scanSession, scanEngine, scanTables)) } finally { scanSession.close() }
        const raw = new Float64Array(energies.length * 2)
        for (let point = 0; point < energies.length; ++point) {
          if (energies[point] > 700) { raw[point * 2] = 1; raw[point * 2 + 1] = mode === 'dichroic' ? 1 : 0; continue }
          const single = structuredClone(project)
          single.scripts.enabled = false
          single.experiment.energy = energies[point]
          single.sample.layers[1].thickness = (energies[point] - 600) * 2
          single.datasets[0].columns = { qz: [coordinates[point]], reflectivity: [1] }
          single.sample.layers.forEach((layer, index) => {
            const lookup = numerical.lookup(scanTables[index], [HC_EV_ANGSTROM / (HC_EV_ANGSTROM / energies[point])], 0)
            layer.delta = lookup.values[0]; layer.beta = lookup.values[1]
          })
          const one = calculateRealCurve(single, [], segmentedNumerical, 'qz', mode,
            { layers: single.sample.layers, layerDepths: [0, 7, 7], dielectricTensors: [null, null, null], cursors: new Map() })
          raw[point * 2] = one.reflectivityPlus[0]; raw[point * 2 + 1] = one.reflectivityMinus[0]
        }
        const reference = postprocessParrattResult(project, coordinates, adapter.convolveEnergy(instance, energies, raw, .75), mode, energies)
        for (const column of ['reflectivityPlus', 'reflectivityMinus', 'asymmetry'] as const) {
          if (actual[column].length !== reference[column].length || actual[column].some((value, index) => !Number.isFinite(value) ||
              Math.abs(value - reference[column][index]) > 1e-15 + 1e-10 * Math.abs(reference[column][index]))) {
            throw new Error('Segmented energy routing differs from independent per-energy qz calculations')
          }
        }
        if (sliceCounts.length !== 3 || new Set(sliceCounts).size < 2 || JSON.stringify(actual.opticalState.layerDepths) !== '[0,7,7]' ||
            actual.opticalState.layers[1].thickness !== 80 || JSON.stringify(project) !== before) {
          throw new Error('Segmented energy preparation lost variable geometry or original state')
        }
      }
    const segmentedEnergyPassed = true
    const depthProject = createDefaultProject()
    depthProject.sample.layers = [createLayer({ thickness: 999, delta: .01 }), createLayer({ thickness: 7 }), createLayer({ thickness: 999 })]
    depthProject.calculation.automaticOpticalConstants = false
    depthProject.experiment.qzScan.points = 2
    depthProject.scripts.enabled = true
    depthProject.scripts.beforeCalculation = 'thickness[1] = thickness[1] + 1'
    const depthSession = await runtime.createSession()
    try {
      const hook = createBeforeCalculation(depthSession, numerical, [])
      const first = calculateRealCurve(depthProject, [], numerical, 'qz', 'monochromatic', undefined, hook)
      const second = calculateRealCurve(first.scriptedProject!, [], numerical, 'qz', 'monochromatic', first.opticalState, hook)
      if (JSON.stringify(first.opticalState.layerDepths) !== '[0,7,1006]' ||
          JSON.stringify(second.opticalState.layerDepths) !== '[0,7,1006]' || second.opticalState.layers[1].thickness !== 9 ||
          first.opticalState.layerDepths === second.opticalState.layerDepths || depthProject.sample.layers[1].thickness !== 7) {
        throw new Error('Stored depths changed across real WASM/Lua calculations')
      }
    } finally { depthSession.close() }
    const storedDepthsPassed = true
    let preparedReflectionPassed = true
    for (const algorithm of ['parratt', 'zak', 'matrix'] as const) {
      const project = createDefaultProject()
      project.sample.layers = [createLayer({ delta: .01, beta: .001 }), createLayer()]
      project.calculation.algorithm = algorithm
      project.calculation.automaticOpticalConstants = false
      project.scripts.enabled = false
      project.experiment.energy = 640
      project.experiment.qzScan = { qzMin: .09, qzMax: .06, points: 3, useDatasetPoints: false }
      const generated = prepareScriptReflectivityInput(project, 640)
      const inputs = [generated, { ...generated, columns: { qz: [0, -.01, .03, .01],
        reflectivityPlus: [7, 9, 11, 13], reflectivityMinus: [4, 5, 6, 7] } }]
      // Capture before a simulated nested hook changes energy and grid settings.
      project.experiment.energy = 710
      project.experiment.qzScan.qzMax = .5
      for (const input of inputs) for (const fast of [false, true]) {
        project.experiment.resolution = { ...project.experiment.resolution, angularFwhm: .002, fastConvolution: fast }
        const result = calculatePreparedScriptReflectivity(project, input, numerical)
        const raw: number[] = [], exact: number[] = []
        for (const qz of input.columns.qz) {
          const point = structuredClone(project)
          point.experiment.qzScan = { qzMin: qz, qzMax: qz, points: 2, useDatasetPoints: false }
          point.experiment.resolution.fastConvolution = false
          point.experiment.resolution.angularFwhm = 0
          raw.push(fast && qz < 0 ? input.columns.reflectivityPlus![raw.length] : calculateRealCurve(point, [], numerical, 'qz', 'monochromatic').reflectivityPlus[0])
          point.experiment.resolution.angularFwhm = .002
          exact.push(calculateRealCurve(point, [], numerical, 'qz', 'monochromatic').reflectivityPlus[0])
        }
        const convolved = adapter.convolveFastQz(instance, input.columns.qz, new Float64Array(raw.flatMap(value => [value, 0])), .002)
        const expected = fast ? raw.map((_, index) => convolved[index * 2]) : exact
        const close = (value: number, reference: number) => Math.abs(value - reference) <= 1e-15 + 1e-10 * Math.abs(reference)
        preparedReflectionPassed &&= result.reflectivity.every((value, index) => close(value, expected[index])) &&
          result.reflectivityPlus.every((value, index) => close(value, fast ? raw[index] : input.columns.reflectivityPlus?.[index] ?? 1)) &&
          JSON.stringify(result.reflectivityMinus) === JSON.stringify(input.columns.reflectivityMinus ?? []) && JSON.stringify(result.qz) === JSON.stringify(input.columns.qz)
      }
    }
    for (const algorithm of ['parratt', 'matrix'] as const) {
      const prepared = createDefaultProject(); prepared.sample.mode = 'element'
      prepared.experiment.energy = 700
      prepared.calculation.algorithm = algorithm
      prepared.calculation.segmentation.minThickness = 10
      prepared.sample.elementProfiles = [{ element: 'Fe', f1: 2, f2: 0, f1Mag: 0, f2Mag: 0,
        slabs: [{ thickness: 0, roughness: 0, density: 2 }, { thickness: 0, roughness: 0, density: 3 }] }]
      const scattering = new Float64Array(18); scattering[0] = scattering[8] = scattering[16] = 2
      // Controlled step lookup only for this pipeline test; not a production erf choice.
      const density = createElementDensitySampler(prepared.sample.elementProfiles, x => x < 0 ? -1 : 1)
      const generated = prepareElementLayers(prepared, density,
        request => adapter.calculateElementOptics(instance, request), [scattering])
      const energy = HC_EV_ANGSTROM / (HC_EV_ANGSTROM / 700)
      const factor = (.0004151761541 * 1e6) / (energy * energy)
      if (JSON.stringify(generated.positions) !== '[-10,30]' || generated.layers[1][0] !== 40) throw new Error('Element layer boundaries failed')
      generated.layers.forEach((layer, index) => {
        const dielectric = 1 - 2 * (index + 2) * 2 * factor
        if (Math.abs(layer[2] - (1 - Math.sqrt(dielectric))) > 1e-15 ||
            (algorithm === 'matrix' && Math.abs(generated.dielectricTensors[index]![0] - dielectric) > 1e-15)) {
          throw new Error('Element layer WASM optics failed')
        }
      })
    }
    const elementProject = createDefaultProject()
    elementProject.sample.elementProfiles = [{ element: 'Fe', f1: 1, f2: 2, f1Mag: 3, f2Mag: 4, slabs: [] }]
    elementProject.calculation.magnetization.mode = 'add'
    elementProject.calculation.magnetization.direction = { gamma: 0, phi: 0 }
    elementProject.scripts.enabled = true
    elementProject.scripts.beforeCalculation = 'calls = (calls or 0) + 1; f1[0] = calls; if calls == 1 then FillTensors() end'
    const elementSession = await runtime.createSession()
    try {
      const hook = createBeforeCalculation(elementSession, numerical, [])
      const first = hook(elementProject, { layers: elementProject.sample.layers,
        dielectricTensors: elementProject.sample.layers.map(() => null), cursors: new Map() })
      const second = hook(first.project, first.opticalState)
      const expected = [1, 2, -4, -3, 0, 0, 4, 3, 1, 2, 0, 0, 0, 0, 0, 0, 1, 2]
      if (!second.opticalState.scatteringTensors?.[0].every((value, index) => value === expected[index]) ||
          second.project.sample.elementProfiles[0].f1 !== 2) throw new Error('Lua element tensor construction/retention failed')
    } finally { elementSession.close() }
    const tables: OpticalTable[] = [
      { name: 'Fe', kind: 'ff', energy: [100, 200], columns: [[20, 40], [2, 4]], warnings: [] },
      { name: 'Fe', kind: 'ffm', energy: [120, 180], columns: [[1, 3], [2, 4]], warnings: [] },
    ]
    const refreshProject = createDefaultProject(); refreshProject.sample.mode = 'element'
    refreshProject.calculation.magnetization.mode = 'add'
    refreshProject.calculation.magnetization.direction = { gamma: 0, phi: 0 }
    refreshProject.sample.elementProfiles = ['Fe', 'missing'].map(element => ({ element, f1: 7, f2: 8, f1Mag: 9, f2Mag: 10, slabs: [] }))
    const refreshed = refreshElementOptics(refreshProject, tables, 150, numerical.lookup, numerical.scatteringTensor!)
    const retained = refreshElementOptics({ ...refreshProject, sample: { ...refreshProject.sample, elementProfiles: refreshed.elementProfiles } },
      tables, 250, numerical.lookup, numerical.scatteringTensor!, new Map(), refreshed.scatteringTensors)
    if (refreshed.elementProfiles[0].f1 !== 30 || refreshed.elementProfiles[0].f2 !== 3 ||
        refreshed.scatteringTensors[0][0] !== 30 || refreshed.scatteringTensors[0][1] !== 3 ||
        refreshed.scatteringTensors[0][2] !== -3 || refreshed.scatteringTensors[0][3] !== -2 ||
        retained.scatteringTensors[0][0] !== 30 || retained.elementProfiles[1].f1 !== 7 ||
        !retained.rangeError || refreshProject.sample.elementProfiles[0].f1 !== 7) throw new Error('Element native refresh/retention failed')
    const opticsProject = createDefaultProject()
    const opticsWorkspace = createScriptArrayWorkspace(opticsProject)
    const opticsTensors = createScriptTensorWorkspace(opticsProject.sample.layers.map(() => ({ values: new Float64Array(18), anisotropic: false })))
    const opticsSession = await runtime.createSession()
    let opticsPassed = false
    let hooksPassed = false
    try {
      const operations = createScriptOptics(opticsWorkspace, opticsTensors,
        [{ name: 'A', kind: 'db', energy: [100, 200], columns: [[.01, .02], [.001, .002]], warnings: [] }],
        (table, energy, cursor) => adapter.lookupTable(instance, table, energy, cursor),
        request => adapter.calculateDielectricTensor(instance, request))
      opticsSession.installArrays(new Map([...opticsWorkspace.arrays, ...opticsTensors.arrays]))
      opticsSession.installProjectFunctions({ ...opticsWorkspace, ...operations })
      opticsSession.execute('SetName(0, "A"); SetDeltaBeta(0, 150); assert(exx_r[0] == 0); FillTensors()', 'Default')
      const actual = opticsTensors.snapshot()[0].values[0]
      const expected = .985 * .985 - .0015 * .0015
      opticsPassed = Math.abs(actual - expected) <= 1e-15 + 1e-10 * Math.abs(expected)
      opticsSession.compile('calls = (calls or 0) + 1; energy = energy + calls; delta[0] = delta[0] + 0.001; assert(math.type(energy) == "float")', 'BeforeCalculation')
      const initial = opticsWorkspace.snapshot(); initial.experiment.energy = 700
      opticsWorkspace.replace(initial, 1)
      runProjectHook(opticsSession, opticsWorkspace)
      const second = runProjectHook(opticsSession, opticsWorkspace)
      hooksPassed = Math.abs(second.experiment.energy - 703) <= 1e-15 + 703e-10 && opticsSession.getGlobal('renewocs') === 0 &&
        Math.abs(opticsWorkspace.snapshot().sample.layers[0].delta - .017) < 1e-15
    } finally { opticsSession.close() }
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
    const nested = await runtime.createSession()
    const hookState = { energy: 700, epsilon: 1e-8, resolution: .01, energyScanQz: .1, renewOpticalConstants: 0 }
    let nestedPassed = false
    try {
      nested.setGlobal('invoke', () => nested.runHook({ ...hookState, energy: 640 }).energy)
      nested.compile('calls = (calls or 0) + 1; if calls % 2 == 1 then energy = 900; assert(invoke() == 641) else energy = energy + 1 end', 'BeforeCalculation')
      nestedPassed = nested.runHook(hookState).energy === 641 && nested.runHook(hookState).energy === 641 && nested.getGlobal('calls') === 4
    } finally { nested.close() }
    for (const caught of [false, true]) {
      const failed = await runtime.createSession()
      failed.setGlobal('invoke', () => failed.execute('local x = 1\nerror("nested failure")', 'BeforeCalculation'))
      let failure = ''
      try { failed.execute(caught ? 'pcall(invoke)' : 'invoke()', 'Default') } catch (error) { failure = String(error) }
      nestedPassed &&= caught ? failure.includes('closed') : /BeforeCalculation:2:.*nested failure/.test(failure)
      try { failed.getGlobal('energy'); nestedPassed = false } catch { /* failed session is closed */ }
      failed.close()
    }
    const parent = await runtime.createSession()
    let childrenPassed = false
    try {
      parent.setGlobal('nestedChild', () => {
        const child = parent.createChildSession()
        try {
          child.execute('counter = (counter or 0) + 1; assert(parentOnly == nil)', 'Default')
          return child.getGlobal('counter')
        } finally { child.close() }
      })
      parent.setGlobal('failedChild', () => {
        const child = parent.createChildSession()
        try { child.execute('error("child failure")', 'BeforeCalculation') } finally { child.close() }
      })
      parent.execute('parentOnly = 42; assert(nestedChild() == 1 and nestedChild() == 1); assert(not pcall(failedChild)); assert(nestedChild() == 1)', 'Default')
      childrenPassed = parent.getGlobal('parentOnly') === 42 && parent.getGlobal('counter') === null
    } finally { parent.close() }
    const replacement = await runtime.createSession()
    try {
      const isolated = replacement.getGlobal('energy') === null
      self.postMessage({ energy, version, diagnostic, isolated, arraysPassed, solutionPassed, tensorPassed, elementsPassed, factorsPassed, functionsPassed, opticsPassed, outputPassed, hooksPassed, nestedPassed, childrenPassed, preparedReflectionPassed, preparedSegmentationPassed, preparedMagneticProfilesPassed, storedDepthsPassed, segmentedQzPassed, segmentedEnergyPassed })
    } finally { replacement.close() }
  } finally { session.close() }
}
run().catch(error => self.postMessage({ error: String(error) }))
