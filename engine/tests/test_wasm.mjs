import { checkAllocationErrors } from './allocation_error_checks.mjs'
import { checkTableSessions, checkTableSessionMemory } from './table_session_checks.mjs'
import { checkVariableEnergy } from './variable_energy_checks.mjs'
import { checkSegmentedOptics, sampleSegmentedOptics } from './segmented_optics_checks.mjs'
import { calculateAdaptiveSegments, calculateSegmentedOptics, createSegmentedOpticalSampler } from '../wasm/segmentation.mjs'
import { checkAdaptiveSegments, sampleAdaptiveSegments } from './adaptive_segments_checks.mjs'
import { checkElementDensity } from './element_density_checks.mjs'
import { checkLayerDensity } from './layer_density_checks.mjs'
import { checkMagneticApplication } from './magnetic_application_checks.mjs'
import { checkSpline } from './spline_checks.mjs'
import { checkAsymmetry } from './asymmetry_checks.mjs'
import { checkElementOptics } from './element_optics_checks.mjs'
import { checkScattering } from './scattering_checks.mjs'
import { calculateFitError } from '../wasm/fit_error.mjs'
import { checkFitErrors } from './fit_error_checks.mjs'
import { minimizeSimplex, minimizeAnnealing, minimizeAdaptiveSimplex } from '../wasm/optimizer.mjs'
import { checkOptimizer } from './optimizer_checks.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { generateErrorFunctionLookup, calculateGaussLorentzianReal, calculateGaussLorentzianImag, calculateParratt, calculateParrattQz, lookupTable, createTableLookupSession, convolveFastQz, convolveEnergy, calculateParrattEnergyScan, calculateDielectricTensor, calculateScatteringTensor, calculateElementOptics, calculateVisnovsky, calculateVisnovskyQz, calculateVisnovskyEnergyScan, calculateZak, calculateZakQz, calculateZakEnergyScan, calculateGaussianProfile, calculateSplineProfile, generateGaussianSplineKnots, applyGaussianProfiles, applyMagneticProfiles, calculateLayerDensity, calculateElementDensity } from '../wasm/parratt.mjs'

const factory = (await import(pathToFileURL(process.argv[2]).href)).default
const module = await factory()
checkAllocationErrors(module, { generateLookup: generateErrorFunctionLookup, fitError: calculateFitError, minimize: minimizeSimplex, subdivide: calculateAdaptiveSegments, prepareOptics: createSegmentedOpticalSampler })
const input = JSON.parse(readFileSync(0, 'utf8'))
checkVariableEnergy(module, calculateParrattEnergyScan, input.scans)
checkVariableEnergy(module, calculateZakEnergyScan, input.zak)
checkVariableEnergy(module, calculateVisnovskyEnergyScan, input.matrices)
const fitErrorValues = checkFitErrors(module, calculateFitError, input.fitErrors)
assert.equal(fitErrorValues, 12480)
console.log(`WASM/native dataset fit errors: ${fitErrorValues} means/residuals, validation, growth and cleanup passed.`)
const optimizerResult = checkOptimizer(module, minimizeSimplex, input.optimizer, calculateParratt, calculateFitError, minimizeAnnealing, minimizeAdaptiveSimplex)
console.log(`WASM/native optimizer: ${optimizerResult.cases} cases, callbacks, Stop, memory growth and cleanup passed.`)
const cases = [...input.angular, ...input.qz.map(prepared => ({ ...prepared, kind: 'qz' }))]
const calculate = prepared => prepared.kind === 'qz' ? calculateParrattQz(module, prepared) : calculateParratt(module, prepared)
let count = 0, maxLogError = 0, zeros = 0, nonpositiveMismatches = 0
for (const [caseIndex, prepared] of cases.entries()) {
  const snapshot = JSON.stringify(prepared)
  const actual = calculate(prepared)
  if (prepared.verifyAsymmetry) checkAsymmetry(actual, prepared.expected, `Parratt case ${caseIndex}`)
  assert.equal(JSON.stringify(prepared), snapshot)
  actual.forEach((value, index) => {
    const target = prepared.expected[index]
    assert.ok(Number.isFinite(value))
    assert.ok(Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target),
      `case ${caseIndex} point ${index}: ${value} vs ${target}`)
    if (value > 0 && target > 0) {
      const relative = (value - target) / target
      const error = Math.abs(relative) < .5 ? Math.abs(Math.log1p(relative) / Math.LN10)
        : Math.abs(Math.log10(value) - Math.log10(target))
      maxLogError = Math.max(maxLogError, error)
    } else if (value === 0 && target === 0) zeros++
    else nonpositiveMismatches++
    count++
  })
}
assert.equal(count, 14884)
let tableValues = 0
for (const table of input.tables) {
  const snapshot = JSON.stringify(table)
  const result = lookupTable(module, table, table.queries, table.cursor)
  assert.equal(JSON.stringify(table), snapshot)
  assert.equal(result.cursor, table.expectedCursor)
  assert.equal(result.values.length, table.expected.length)
  result.values.forEach((value, index) => {
    assert.ok(Math.abs(value - table.expected[index]) <= 1e-15 + 1e-10 * Math.abs(table.expected[index]))
    tableValues++
  })
}
assert.equal(tableValues, 14760)
let energyValues = 0
for (const item of input.energy) {
  const raw = new Float64Array(item.raw)
  const actual = (item.kind === 'fast-qz' ? convolveFastQz : convolveEnergy)(module, item.energy, raw, item.width)
  assert.deepEqual(Array.from(raw), item.raw)
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - item.expected[index]) <= 1e-15 + 1e-10 * Math.abs(item.expected[index]))
    energyValues++
  })
}
assert.equal(energyValues, 3360)
const energyRaw = new Float64Array([1, 2, 3, 4])
const energyBefore = convolveEnergy(module, [1, 2], energyRaw, .1)
for (const [energies, values, width] of [[[], energyRaw, 1], [new Array(2), energyRaw, 1], [[1, 2], [1, 2, 3, 4], 1], [[1, 2], energyRaw, -1]]) {
  assert.throws(() => convolveEnergy(module, energies, values, width), TypeError)
}
assert.throws(() => convolveEnergy(module, [1, 2], energyRaw, 1e308), { status: 2 })
let scanValues = 0
for (const item of input.scans) {
  const snapshot = JSON.stringify(item)
  const actual = calculateParrattEnergyScan(module, item)
  assert.equal(JSON.stringify(item), snapshot)
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - item.expected[index]) <= 1e-15 + 1e-10 * Math.abs(item.expected[index]))
    scanValues++
  })
}
assert.equal(scanValues, 1728)
const scanPrepared = input.scans[1]
const scanBefore = calculateParrattEnergyScan(module, scanPrepared)
for (const change of [{ stacks: [] }, { stacks: new Array(3) }, { enabled: [1, 2, 1] }, { energy: [] }, { angularWidth: -1 }]) {
  assert.throws(() => calculateParrattEnergyScan(module, { ...scanPrepared, ...change }), TypeError)
}
assert.throws(() => calculateParrattEnergyScan(module, { ...scanPrepared, qz: [0, 0, 1e10] }), { status: 4 })
function evaluateProfile(core, request) {
  if (request.kind === 'segmented-optics') return sampleSegmentedOptics(core, calculateSegmentedOptics, request)
  if (request.kind === 'adaptive') return sampleAdaptiveSegments(core, calculateAdaptiveSegments, request)
  if (request.kind === 'spline') return calculateSplineProfile(core, request)
  if (request.kind === 'element-density') return calculateElementDensity(core, request)
  if (request.kind === 'density') return calculateLayerDensity(core, request)
  if (request.kind === 'mixed-application') return applyMagneticProfiles(core, request)
  if (request.kind === 'application') return applyGaussianProfiles(core, request)
  if (request.kind === 'gaussian') return calculateGaussianProfile(core, request)
  const result = generateGaussianSplineKnots(core, request)
  return new Float64Array([...result.positions, ...result.values])
}
let profileCount = 0
for (const [caseIndex, request] of input.profiles.entries()) {
  const snapshot = JSON.stringify(request)
  const actual = evaluateProfile(module, request)
  assert.equal(JSON.stringify(request), snapshot)
  assert.equal(actual.length, request.expected.length)
  actual.forEach((value, index) => {
    const target = request.expected[index]
    assert.ok(Number.isFinite(value) && Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target),
      `Gaussian profile ${caseIndex}, value ${index}: ${value} vs ${target}`)
    profileCount++
  })
}
assert.equal(profileCount, 77180)
checkTableSessions(module, createTableLookupSession, lookupTable, input.tables)
checkTableSessionMemory(module, createTableLookupSession, () => checkSegmentedOptics(module, calculateSegmentedOptics, calculateAdaptiveSegments, createSegmentedOpticalSampler))
checkAdaptiveSegments(module, calculateAdaptiveSegments)
checkLayerDensity(module, calculateLayerDensity, generateErrorFunctionLookup)
checkElementDensity(module, calculateElementDensity)
checkMagneticApplication(module, applyMagneticProfiles)
checkSpline(module, calculateSplineProfile)
const profileRequests = input.profiles.slice(2, 4)
const profileBefore = profileRequests.map(request => evaluateProfile(module, request))
for (const request of profileRequests) {
  for (const profile of [[], new Array(4), [0, 1, 1, NaN]])
    assert.throws(() => evaluateProfile(module, { ...request, profile }), TypeError)
}
assert.throws(() => calculateGaussianProfile(module, { profile: [0, 1, 1, 1], positions: new Array(2) }), TypeError)
assert.throws(() => calculateGaussianProfile(module, { profile: [0, 1e308, 1, 1], positions: [0, 1e308] }), { status: 2 })
assert.throws(() => generateGaussianSplineKnots(module, { profile: [0, 1e308, 1, 1] }), { status: 2 })
for (const intervals of [-1, 1.5, Infinity, 2147483647])
  assert.throws(() => generateGaussianSplineKnots(module, { profile: [0, 1, 1, 1], intervals }), TypeError)
assert.throws(() => generateGaussianSplineKnots(module, { profile: [0, 1, 1, 1], intervals: 2147483642 }), RangeError)
const applicationRequest = input.profiles.find(item => item.kind === 'application')
for (const change of [{ profiles: new Array(4) }, { positions: new Array(8) }, { initialValues: [] },
  { weights: new Array(8) }, { weights: [new Array(4)] }, { coupled: 2 }])
  assert.throws(() => applyGaussianProfiles(module, { ...applicationRequest, ...change }), TypeError)
const emptyProfiles = { profiles: [], positions: [0, 1], initialValues: [1, 2, 3, 4], weights: [[], []], coupled: 1 }
assert.deepEqual(Array.from(applyGaussianProfiles(module, emptyProfiles)), emptyProfiles.initialValues)
const overflowProfile = { profiles: [[0, 1e308, 1, 1]], positions: [0, 1e308], initialValues: [1, 1, 1, 1], weights: [[1], [1]], coupled: 0 }
assert.throws(() => applyGaussianProfiles(module, overflowProfile), { status: 2 })
assert.deepEqual(Array.from(applyGaussianProfiles(module, { ...overflowProfile, weights: [[1], [0]] })), [2, 2, 1, 1])
assert.deepEqual(Array.from(applyGaussianProfiles(module, { ...overflowProfile, profiles: [[0, 1e308, 0, 0]] })), [1, 1, 1, 1])
profileRequests.push(applicationRequest)
profileBefore.push(evaluateProfile(module, applicationRequest))
let zakCount = 0
for (const [caseIndex, prepared] of input.zak.entries()) {
  const snapshot = JSON.stringify(prepared)
  const actual = prepared.kind === 'energy' ? calculateZakEnergyScan(module, prepared) : prepared.kind === 'qz' ? calculateZakQz(module, prepared) : calculateZak(module, prepared)
  assert.equal(JSON.stringify(prepared), snapshot)
  assert.equal(actual.length, prepared.expected.length)
  if (prepared.verifyAsymmetry) checkAsymmetry(actual, prepared.expected, `Zak case ${caseIndex}`)
  actual.forEach((value, index) => {
    const target = prepared.expected[index]
    assert.ok(Number.isFinite(value) && Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target),
      `Zak case ${caseIndex}, beam ${index}: ${value} vs ${target}`)
    zakCount++
  })
}
assert.equal(zakCount, 15698)
const zakSingle = input.zak[0]
const zakQz = input.zak.find(item => item.kind === 'qz' && item.mode === 1 && item.resolution?.width > 1e-10)
const zakEnergy = input.zak.find(item => item.kind === 'energy' && item.mode === 1 && item.energyWidth > 1e-10)
const zakOperations = [[calculateZak, zakSingle], [calculateZakQz, zakQz], [calculateZakEnergyScan, zakEnergy]]
const zakBefore = zakOperations.map(([calculate, request]) => calculate(module, request))
for (const [calculate, request] of zakOperations) {
  for (const change of [{ magnetic: 2 }, { beam1: new Array(4) }, { analyzer: 3 }])
    assert.throws(() => calculate(module, { ...request, ...change }), TypeError)
}
for (const change of [{ layers: new Array(2) }, { layers: [[0]] }, { angle: NaN }, { waveNumber: Infinity }])
  assert.throws(() => calculateZak(module, { ...zakSingle, ...change }), TypeError)
const zeroFilm = [[0, 0, .01, .002, 0, 0, 0, 0], [0, 0, .006, .001, 0, 0, 0, 0], Array(8).fill(0)]
assert.throws(() => calculateZak(module, { ...zakSingle, layers: zeroFilm }), { status: 2 })
for (const change of [{ layers: new Array(2) }, { qz: new Array(2) }, { energy: 0 }, { mode: 2 }, { resolution: { width: -1, fast: false } }])
  assert.throws(() => calculateZakQz(module, { ...zakQz, ...change }), TypeError)
assert.throws(() => calculateZakQz(module, { ...zakQz, qz: [0, 1e10] }), { status: 4 })
assert.equal(calculateZakQz(module, { ...zakQz, mode: 0, beam2: null })[1], 0)
for (const change of [{ stacks: new Array(4) }, { enabled: [1, 1, 1, 2] }, { energy: [640] }, { energyWidth: -1 }, { angularWidth: NaN }])
  assert.throws(() => calculateZakEnergyScan(module, { ...zakEnergy, ...change }), TypeError)
const unequalZakStacks = structuredClone(zakEnergy)
unequalZakStacks.stacks[1] = unequalZakStacks.stacks[1].slice(0, 1)
assert.throws(() => calculateZakEnergyScan(module, unequalZakStacks), TypeError)
assert.throws(() => calculateZakEnergyScan(module, { ...zakEnergy, qz: [0, 0, 0, 1e10] }), { status: 4 })
assert.deepEqual(Array.from(calculateZakEnergyScan(module, { ...zakEnergy, mode: 0, beam2: null,
  enabled: [0, 0, 0, 0], energyWidth: 0 })), [1, 0, 1, 0, 1, 0, 1, 0])
let matrixCount = 0, asymmetryCount = 0
for (const [caseIndex, prepared] of input.matrices.entries()) {
  const snapshot = JSON.stringify(prepared)
  const actual = prepared.kind === 'energy' ? calculateVisnovskyEnergyScan(module, prepared) : prepared.kind === 'qz' ? calculateVisnovskyQz(module, prepared) : calculateVisnovsky(module, prepared)
  assert.equal(JSON.stringify(prepared), snapshot)
  assert.equal(actual.length, prepared.expected.length)
  if (prepared.verifyAsymmetry) asymmetryCount += checkAsymmetry(actual, prepared.expected, `Visnovsky case ${caseIndex}`)
  actual.forEach((value, index) => {
    const target = prepared.expected[index]
    assert.ok(Number.isFinite(value) && Math.abs(value - target) <= 1e-15 + 1e-10 * Math.abs(target),
      `Visnovsky case ${caseIndex}, beam ${index}: ${value} vs ${target}`)
    matrixCount++
  })
}
assert.equal(matrixCount, 18288)
assert.equal(asymmetryCount, 2400)
console.log(`WASM/native derived matrix asymmetry: ${asymmetryCount} values matched.`)
const matrixPrepared = input.matrices[0]
const matrixBefore = calculateVisnovsky(module, matrixPrepared)
for (const change of [{ layers: new Array(2) }, { layers: [] }, { angle: NaN }, { analyzer: 3 }, { beam2: new Array(4) }]) {
  assert.throws(() => calculateVisnovsky(module, { ...matrixPrepared, ...change }), TypeError)
}
const invalidMatrix = structuredClone(matrixPrepared)
invalidMatrix.layers[0].anisotropic = 2
assert.throws(() => calculateVisnovsky(module, invalidMatrix), TypeError)
invalidMatrix.layers[0].anisotropic = 0
invalidMatrix.layers[0].values[2] = 0
invalidMatrix.layers[0].values[3] = 0
assert.throws(() => calculateVisnovsky(module, invalidMatrix), { status: 2 })
const matrixQzPrepared = input.matrices.find(item => item.kind === 'qz' && item.mode === 1 && item.resolution?.width > 1e-10)
const matrixQzBefore = calculateVisnovskyQz(module, matrixQzPrepared)
for (const change of [{ qz: [] }, { qz: new Array(2) }, { energy: 0 }, { epsilon: NaN },
    { beam2: null }, { mode: 2 }, { resolution: { width: 0, fast: 1 } }, { resolution: { width: -1, fast: false } }]) {
  assert.throws(() => calculateVisnovskyQz(module, { ...matrixQzPrepared, ...change }), TypeError)
}
assert.throws(() => calculateVisnovskyQz(module, { ...matrixQzPrepared, qz: [0, 1e10] }), { status: 4 })
assert.equal(calculateVisnovskyQz(module, { ...matrixQzPrepared, mode: 0, beam2: null })[1], 0)
const matrixEnergyPrepared = input.matrices.find(item => item.kind === 'energy' && item.mode === 1 && item.energyWidth > 1e-10)
const matrixEnergyBefore = calculateVisnovskyEnergyScan(module, matrixEnergyPrepared)
for (const change of [{ stacks: new Array(4) }, { stacks: [] }, { energy: [0, 1, 2, 3] },
    { qz: [0] }, { enabled: [1, 2, 1, 1] }, { angularWidth: -1 }, { energyWidth: NaN }, { epsilon: Infinity }]) {
  assert.throws(() => calculateVisnovskyEnergyScan(module, { ...matrixEnergyPrepared, ...change }), TypeError)
}
const shortStack = structuredClone(matrixEnergyPrepared)
shortStack.stacks[1] = shortStack.stacks[1].slice(0, 1)
assert.throws(() => calculateVisnovskyEnergyScan(module, shortStack), TypeError)
assert.throws(() => calculateVisnovskyEnergyScan(module, { ...matrixEnergyPrepared, qz: [0, 0, 0, 1e10] }), { status: 4 })
assert.deepEqual(Array.from(calculateVisnovskyEnergyScan(module, { ...matrixEnergyPrepared,
  enabled: [0, 0, 0, 0], mode: 0, beam2: null, energyWidth: 0 })), [1, 0, 1, 0, 1, 0, 1, 0])
assert.equal(checkElementOptics(module, calculateElementOptics, input.elementOptics, calculateParrattQz), 5200)
console.log('WASM/native element optics: 5,200 values, validation, growth and cleanup passed.')
assert.equal(checkScattering(module, calculateScatteringTensor, input.scattering), 8640)
console.log('WASM/native scattering tensors: 8,640 components, validation, growth and cleanup passed.')
let tensorValues = 0
for (const item of input.tensors) {
  const snapshot = JSON.stringify(item)
  const actual = calculateDielectricTensor(module, item)
  assert.equal(JSON.stringify(item), snapshot)
  assert.equal(actual.anisotropic, item.anisotropic)
  assert.equal(actual.values.length, 18)
  actual.values.forEach((value, index) => {
    assert.ok(Math.abs(value - item.expected[index]) <= 1e-15 + 1e-10 * Math.abs(item.expected[index]))
    tensorValues++
  })
}
assert.equal(tensorValues, 8640)
const tensorPrepared = input.tensors[1]
const tensorBefore = calculateDielectricTensor(module, tensorPrepared)
for (const change of [{ layer: new Array(8) }, { layer: [] }, { tensor: 2 }, { magnetic: -1 }]) {
  assert.throws(() => calculateDielectricTensor(module, { ...tensorPrepared, ...change }), TypeError)
}
assert.throws(() => calculateDielectricTensor(module, { ...tensorPrepared, layer: [0, 0, 1e308, 0, 0, 0, 0, 0] }), { status: 2 })
const duplicateTable = { energy: [1, 2, 2, 3], columns: [[10, 20, 30, 40]] }
const firstLookup = lookupTable(module, duplicateTable, [2])
assert.deepEqual(Array.from(firstLookup.values), [20])
const secondLookup = lookupTable(module, duplicateTable, [2, 2], firstLookup.cursor)
assert.deepEqual(Array.from(secondLookup.values), [20, 30])
assert.equal(secondLookup.cursor, 3)
assert.deepEqual(Array.from(lookupTable(module, { energy: [], columns: [[], []] }, [1, 2]).values), [0, 0, 0, 0])
assert.throws(() => lookupTable(module, { energy: [2, 1], columns: [[1, 2]] }, [1.5]), { status: 1 })
assert.throws(() => lookupTable(module, { energy: [1, 2, 3], columns: [[1, 1e308, -1e308]] }, [1, 2.5]), { status: 2 })
assert.throws(() => lookupTable(module, duplicateTable, [2], -1), TypeError)
assert.throws(() => lookupTable(module, duplicateTable, [2], 0x100000000), TypeError)
assert.equal(lookupTable(module, duplicateTable, [0], 0xffffffff).cursor, 0xffffffff)
assert.throws(() => lookupTable(module, { energy: [1], columns: new Array(2) }, [1]), TypeError)
assert.throws(() => lookupTable(module, { energy: [1], columns: [[1, 2]] }, [1]), TypeError)
assert.throws(() => lookupTable(module, duplicateTable, []), TypeError)
const prepared = cases[0]
const before = calculateParratt(module, prepared)
const qzPrepared = input.qz[1]
const qzBefore = calculateParrattQz(module, qzPrepared)
const resolvedPrepared = { ...qzPrepared, qz: [.01, .02], resolution: { width: .002, fast: false } }
const resolvedBefore = calculateParrattQz(module, resolvedPrepared)
const oldBuffer = module.HEAPF64.buffer
const largeAllocation = module._malloc(oldBuffer.byteLength + 1024)
assert.ok(largeAllocation)
assert.notEqual(module.HEAPF64.buffer, oldBuffer)
profileRequests.forEach((request, index) => assert.deepEqual(evaluateProfile(module, request), profileBefore[index]))
zakOperations.forEach(([calculate, request], index) => assert.deepEqual(calculate(module, request), zakBefore[index]))
assert.deepEqual(calculateVisnovskyEnergyScan(module, matrixEnergyPrepared), matrixEnergyBefore)
assert.deepEqual(calculateVisnovskyQz(module, matrixQzPrepared), matrixQzBefore)
assert.deepEqual(calculateVisnovsky(module, matrixPrepared), matrixBefore)
assert.deepEqual(calculateDielectricTensor(module, tensorPrepared), tensorBefore)
assert.deepEqual(calculateParrattEnergyScan(module, scanPrepared), scanBefore)
assert.deepEqual(convolveEnergy(module, [1, 2], energyRaw, .1), energyBefore)
module._free(largeAllocation)
assert.deepEqual(calculateParratt(module, prepared), before)
assert.deepEqual(lookupTable(module, duplicateTable, [2, 2], firstLookup.cursor), secondLookup)
assert.throws(() => calculateParratt(module, { ...prepared, beam: [NaN, 0, 0, 0] }), TypeError)
assert.throws(() => calculateParratt(module, { ...prepared, points: [[.1, 0, 0]] }), { status: 1 })
assert.throws(() => calculateParratt(module, { ...prepared,
  layers: [[0, 0, 1e308, 1e308, 0, 0, 90, 90], [0, 0, 0, 0, 0, 0, 90, 90]] }), { status: 2 })
assert.deepEqual(calculateParratt(module, prepared), before)
assert.equal(module._remagx_parratt(0, 2, 0, 1, 0, 0, 0, 0), 1)
assert.deepEqual(calculateParrattQz(module, qzPrepared), qzBefore)
const limit = 2 * (2 * Math.PI / (12398.326 / qzPrepared.energy))
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, qz: [.01, limit], mode: 0 }), { status: 4 })
assert.ok(calculateParrattQz(module, { ...qzPrepared, qz: [limit] }).every(Number.isFinite))
assert.deepEqual(Array.from(calculateParrattQz(module, { ...qzPrepared, qz: [-limit] })), [0, 0])
assert.deepEqual(calculateParrattQz(module, resolvedPrepared), resolvedBefore)
for (const resolution of [null, { width: -1, fast: false }, { width: NaN, fast: false }, { width: 0, fast: 1 }]) {
  assert.throws(() => calculateParrattQz(module, { ...resolvedPrepared, resolution }), TypeError)
}
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, qz: [limit], resolution: { width: 0, fast: true } }), { status: 4 })
assert.deepEqual(calculateParrattQz(module, resolvedPrepared), resolvedBefore)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, qz: [] }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, qz: new Array(2) }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, layers: new Array(2) }), TypeError)
assert.throws(() => calculateParratt(module, { ...prepared, beam: new Array(4) }), TypeError)
assert.throws(() => calculateParratt(module, { ...prepared, points: [new Array(3)] }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, energy: 0 }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared, beam2: null }), TypeError)
assert.throws(() => calculateParrattQz(module, { ...qzPrepared,
  layers: [[0, 0, 1e308, 1e308, 0, 0, 90, 90], [0, 0, 0, 0, 0, 0, 90, 90]] }), { status: 2 })
assert.deepEqual(calculateParrattQz(module, qzPrepared), qzBefore)
// Exercise partial-allocation cleanup without exhausting the process's real memory.
let allocations = 0
const outstanding = new Set()
const failingAllocator = new Proxy(module, {
  get(target, key) {
    if (key === '_malloc') return bytes => {
      if (++allocations === 3) return 0
      const pointer = target._malloc(bytes)
      outstanding.add(pointer)
      return pointer
    }
    if (key === '_free') return pointer => {
      assert.ok(outstanding.delete(pointer))
      target._free(pointer)
    }
    return target[key]
  },
})
assert.throws(() => calculateParratt(failingAllocator, prepared), /allocation failed/)
assert.equal(outstanding.size, 0)
allocations = 0
assert.throws(() => calculateParrattQz(failingAllocator, resolvedPrepared), /allocation failed/)
assert.equal(outstanding.size, 0)
allocations = 0
assert.throws(() => lookupTable(failingAllocator, duplicateTable, [2]), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.deepEqual(lookupTable(module, duplicateTable, [2, 2], firstLookup.cursor), secondLookup)
assert.deepEqual(calculateParrattQz(module, qzPrepared), qzBefore)
assert.deepEqual(calculateParratt(module, prepared), before)
console.log(`WASM/native: ${count} comparisons; max log10 error ${maxLogError} decades; ${zeros} zero pairs; ${nonpositiveMismatches} nonpositive mismatches; memory growth and error recovery passed`)

console.log(`WASM/native tables: ${tableValues} values and ${input.tables.length} cursors passed, including cursor continuation and cleanup.`)

allocations = 0
assert.throws(() => convolveEnergy(failingAllocator, [1, 2], energyRaw, .1), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.deepEqual(convolveEnergy(module, [1, 2], energyRaw, .1), energyBefore)
console.log(`WASM/native energy/fast-qz convolution: ${energyValues} values, validation and cleanup passed.`)

allocations = 0
assert.throws(() => calculateParrattEnergyScan(failingAllocator, scanPrepared), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.deepEqual(calculateParrattEnergyScan(module, scanPrepared), scanBefore)
console.log(`WASM/native prepared energy scans: ${scanValues} intensities, validation and cleanup passed.`)

allocations = 0
assert.throws(() => calculateDielectricTensor(failingAllocator, tensorPrepared), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.deepEqual(calculateDielectricTensor(module, tensorPrepared), tensorBefore)
console.log(`WASM/native dielectric tensors: ${tensorValues} components and ${input.tensors.length} classifications, validation and cleanup passed.`)

allocations = 0
assert.throws(() => calculateVisnovsky(failingAllocator, matrixPrepared), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.deepEqual(calculateVisnovsky(module, matrixPrepared), matrixBefore)
console.log(`WASM/native Visnovsky: ${matrixCount} intensities, validation, memory growth and cleanup passed.`)

allocations = 0
assert.throws(() => calculateVisnovskyQz(failingAllocator, matrixQzPrepared), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.deepEqual(calculateVisnovskyQz(module, matrixQzPrepared), matrixQzBefore)
console.log('Visnovsky qz validation, memory growth and allocation cleanup passed.')

allocations = 0
assert.throws(() => calculateVisnovskyEnergyScan(failingAllocator, matrixEnergyPrepared), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.deepEqual(calculateVisnovskyEnergyScan(module, matrixEnergyPrepared), matrixEnergyBefore)
console.log('Visnovsky energy-scan validation, memory growth and allocation cleanup passed.')

for (const [index, [calculate, request]] of zakOperations.entries()) {
  allocations = 0
  assert.throws(() => calculate(failingAllocator, request), /allocation failed/)
  assert.equal(outstanding.size, 0)
  assert.deepEqual(calculate(module, request), zakBefore[index])
}
console.log(`WASM/native Zak: ${zakCount} intensities, validation, memory growth and cleanup passed.`)

for (const [index, request] of profileRequests.entries()) {
  allocations = 0
  assert.throws(() => evaluateProfile(failingAllocator, request), /allocation failed/)
  assert.equal(outstanding.size, 0)
  assert.deepEqual(evaluateProfile(module, request), profileBefore[index])
}
console.log(`WASM/native Gaussian/spline profiles, application and density: ${profileCount} values, validation, memory growth and cleanup passed.`)


for (const [calculate, request] of [
  [calculateParrattEnergyScan, input.scans.find(item => item.pointSettings)],
  [calculateVisnovskyEnergyScan, input.matrices.find(item => item.pointSettings)],
  [calculateZakEnergyScan, input.zak.find(item => item.pointSettings)],
]) {
  for (const pointSettings of [[], new Array(4), [[640, 0, 1e-8]],
    [[640, 0, 1e-8], [640, 0, 1e-8], [640, 0, 1e-8], [0, 0, 1e-8]],
    request.pointSettings.map((row, index) => index === 3 ? [row[0], -1, row[2]] : row),
    request.pointSettings.map((row, index) => index === 3 ? [row[0], row[1], NaN] : row)]) {
    assert.throws(() => calculate(module, { ...request, pointSettings }), TypeError)
  }
  allocations = 0
  assert.throws(() => calculate(failingAllocator, request), /allocation failed/)
  assert.equal(outstanding.size, 0)
  // Check all buffer cleanup on a native failure after every allocation succeeded.
  allocations = 3
  assert.throws(() => calculate(failingAllocator, { ...request, qz: [.02, .03, .04, 1e10] }), { status: 4 })
  assert.equal(outstanding.size, 0)
  const values = calculate(module, request)
  values.forEach((value, index) => assert.ok(Math.abs(value - request.expected[index]) <= 1e-15 + 1e-10 * Math.abs(request.expected[index])))
}
console.log('Per-point energy settings: validation, memory growth, allocation cleanup and native failure recovery passed.')


assert.equal(input.lineShapes.length, 1218)
for (const item of input.lineShapes) {
  const actual = (item.kind === 'real' ? calculateGaussLorentzianReal : calculateGaussLorentzianImag)(module, item.parameters)
  assert.ok(Math.abs(actual - item.expected) <= 1e-15 + 1e-10 * Math.abs(item.expected))
}
for (const parameters of [[], new Array(5), [640, 640, NaN, .1, 50]])
  assert.throws(() => calculateGaussLorentzianImag(module, parameters), TypeError)
allocations = 3
assert.throws(() => calculateGaussLorentzianImag(failingAllocator, [1, 0, 1, 2, -100]), { status: 2 })
assert.equal(outstanding.size, 0)
allocations = 2
assert.throws(() => calculateGaussLorentzianImag(failingAllocator, [640, 640, .03, .1, 50]), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.equal(calculateGaussLorentzianImag(module, [640, 640, .03, .1, 50]), .03 / .1)
console.log('WASM/native Gauss-Lorentzian helpers: 1,218 values matched; imaginary validation and cleanup passed.')

for (const parameters of [[], new Array(5), [640, 640, NaN, .1, 50]])
  assert.throws(() => calculateGaussLorentzianReal(module, parameters), TypeError)
allocations = 3
assert.throws(() => calculateGaussLorentzianReal(failingAllocator, [-.001234, 0, .03, .1, 50]), { status: 2 })
assert.equal(outstanding.size, 0)
allocations = 2
assert.throws(() => calculateGaussLorentzianReal(failingAllocator, [640, 640, .03, .1, 50]), /allocation failed/)
assert.equal(outstanding.size, 0)
assert.ok(Number.isFinite(calculateGaussLorentzianReal(module, [640, 640, .03, .1, 50])))
console.log('WASM/native Gauss-Lorentzian real part: 588 values, validation and cleanup passed.')

// Run after memory-growth checks; native errors and failed allocations must free
// every temporary buffer without invalidating the next prepared-sample call.
for (const [coordinates, values, width] of [[[], energyRaw, 1], [new Array(2), energyRaw, 1], [[1, 2], [1, 2, 3, 4], 1], [[1, 2], energyRaw, -1]])
  assert.throws(() => convolveFastQz(module, coordinates, values, width), TypeError)
for (const available of [0, 1, 2]) {
  allocations = available
  assert.throws(() => convolveFastQz(failingAllocator, [1, 2], energyRaw, .1), /allocation failed/)
  assert.equal(outstanding.size, 0)
}
allocations = 5
assert.throws(() => convolveFastQz(failingAllocator, [1, 2], new Float64Array([1e308, 0, -1e308, 0]), .1), { status: 2 })
assert.equal(outstanding.size, 0)
const retainedCase = input.energy.find(item => item.kind === 'fast-qz')
assert.deepEqual(Array.from(convolveFastQz(module, retainedCase.energy, new Float64Array(retainedCase.raw), retainedCase.width)), retainedCase.expected)
assert.deepEqual(Array.from(convolveFastQz(module, [-1], new Float64Array([7, 9]), 0)), [0, 0])
assert.ok(convolveFastQz(module, [1, 2], energyRaw, 1e308).every(Number.isFinite))
console.log('Prepared fast-qz convolution: 1,680 native values, memory growth, validation and cleanup passed.')
