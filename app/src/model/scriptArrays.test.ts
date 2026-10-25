import { expect, it } from 'vitest'
import { createDefaultProject, createDepthProfileFunction, createLayer } from './defaults'
import { createScriptArrayWorkspace } from './scriptArrays'

function fixture() {
  const project = createDefaultProject()
  project.sample.layers = [createLayer({ delta: .01 }), createLayer({ delta: .02 })]
  project.sample.depthProfileFunctions = [createDepthProfileFunction()]
  project.sample.elementProfiles = [{ element: 'Fe', f1: 26, f2: 1, f1Mag: 0, f2Mag: 0, slabs: [] }]
  project.scripts.parameters = [7, 8]
  return project
}

it('maps all 16 scalar arrays to the original IDs and project fields without scaling', () => {
  const workspace = createScriptArrayWorkspace(fixture())
  const ids: Record<string, number> = { delta: 0, beta: 1, sigma: 2, thickness: 3, deltam: 4,
    betam: 5, gauss_delta: 11, gauss_beta: 12, gauss_variance: 13, gauss_z: 14,
    par: 34, f1: 35, f2: 36, density: 37, maggamma: 38, magphi: 39 }
  expect(workspace.arrays.size).toBe(16)
  for (const [name, typeId] of Object.entries(ids)) {
    const array = workspace.arrays.get(name)!
    expect(array.typeId).toBe(typeId)
    array.write(0, typeId + .125)
    expect(array.read(0)).toBe(typeId + .125)
  }
  const result = workspace.snapshot()
  expect(result.sample.layers[0]).toMatchObject({ delta: .125, beta: 1.125, roughness: 2.125,
    thickness: 3.125, deltaMag: 4.125, betaMag: 5.125, density: 37.125,
    magnetization: { gamma: 38.125, phi: 39.125 } })
  expect(result.sample.depthProfileFunctions[0]).toMatchObject({ deltaAmplitude: 11.125,
    betaAmplitude: 12.125, width: 13.125, center: 14.125 })
  expect(result.scripts.parameters).toEqual([34.125, 8])
  expect(result.sample.elementProfiles[0]).toMatchObject({ f1: 35.125, f2: 36.125 })
})

it('uses zero-based substrate-first indexing and inclusive maximum indices', () => {
  const workspace = createScriptArrayWorkspace(fixture())
  const delta = workspace.arrays.get('delta')!
  expect(delta.maximumIndex).toBe(1)
  expect(delta.read(0)).toBe(.01)
  expect(delta.read(1)).toBe(.02)
  for (const index of [-1, 2, .5, NaN, Infinity]) {
    expect(() => delta.read(index)).toThrow('index out of range')
    expect(() => delta.write(index, 1)).toThrow('index out of range')
  }
  const empty = createScriptArrayWorkspace(createDefaultProject()).arrays.get('par')!
  expect(empty.maximumIndex).toBe(-1)
  expect(() => empty.read(0)).toThrow('index out of range')
})

it('isolates writes and snapshots, preserves signed values, and rejects nonfinite writes', () => {
  const source = fixture()
  const before = JSON.stringify(source)
  const workspace = createScriptArrayWorkspace(source)
  const thickness = workspace.arrays.get('thickness')!
  thickness.write(0, -2)
  expect(thickness.read(0)).toBe(-2)
  thickness.write(0, -0)
  expect(Object.is(thickness.read(0), -0)).toBe(true)
  for (const value of [NaN, Infinity, -Infinity]) expect(() => thickness.write(0, value)).toThrow('finite')
  const snapshot = workspace.snapshot()
  snapshot.sample.layers[0].thickness = 99
  expect(Object.is(thickness.read(0), -0)).toBe(true)
  expect(JSON.stringify(source)).toBe(before)
})

it('keeps stored layer arrays separate from element slabs in element mode', () => {
  const source = fixture(); source.sample.mode = 'element'
  const workspace = createScriptArrayWorkspace(source)
  workspace.arrays.get('delta')!.write(0, .25)
  workspace.arrays.get('thickness')!.write(0, 123)
  workspace.setLayerText(0, 'opticalTable', 'stored-table')
  expect(workspace.snapshot().sample.layers[0]).toMatchObject({ delta: .25, thickness: 123, opticalTable: 'stored-table' })
  expect(workspace.snapshot().sample.elementProfiles[0].slabs).toEqual(source.sample.elementProfiles[0].slabs)
  workspace.arrays.get('f1')!.write(0, 12.5)
  expect(workspace.snapshot().sample.elementProfiles[0].f1).toBe(12.5)
})


it('preserves every measurement column and metadata while isolating refresh and snapshots', () => {
  const source = fixture()
  const values = [-0, 1e-300, 1e200]
  source.datasets = [{ title: 'measured', comment: 'all columns', sourceFile: 'synthetic', energy: 700,
    energyShift: 1, angularResolution: .01, intensityScale: 2, intensityOffset: 3, qzShift: .02,
    errorWeight: 4, polarization: source.experiment.polarization, active: true,
    columns: { qz: values.slice(), energy: [700, 701, 702], reflectivity: values,
      reflectivityPlus: values, reflectivityMinus: values.slice(), asymmetry: [0, .1, -.1], electronYield: values.slice() } }]
  const expected = structuredClone(source)
  const workspace = createScriptArrayWorkspace(source)
  source.datasets[0].columns.qz[0] = 99
  expect(workspace.snapshot()).toEqual(expected)
  const first = workspace.snapshot()
  expect(first.datasets[0].columns.reflectivity).toBe(first.datasets[0].columns.reflectivityPlus)
  expect(Object.is(first.datasets[0].columns.reflectivity![0], -0)).toBe(true)
  first.datasets[0].columns.reflectivity![1] = 42
  first.datasets[0].comment = 'mutated'
  expect(workspace.snapshot()).toEqual(expected)
  const refreshed = structuredClone(expected)
  refreshed.datasets[0].columns = { qz: [.2, .3], reflectivity: undefined }
  refreshed.datasets[0].title = 'replacement'
  workspace.replace(refreshed)
  const replacement = structuredClone(refreshed)
  refreshed.datasets[0].columns.qz[0] = 77
  expect(workspace.snapshot()).toEqual(replacement)
  const last = workspace.snapshot()
  last.datasets[0].columns.qz.push(99)
  expect(workspace.snapshot()).toEqual(replacement)
})


it('copies the complete project graph while retaining shared metadata only within each snapshot', () => {
  const source = fixture()
  source.datasets = Array.from({ length: 3 }, (_, index) => ({
    title: `dataset ${index}`, comment: 'metadata', sourceFile: '', energy: 700,
    energyShift: -0, angularResolution: 0, intensityScale: 1, intensityOffset: 0,
    qzShift: 0, errorWeight: 1, polarization: source.experiment.polarization, active: true,
    columns: { qz: [.01, .02], reflectivity: [1, 1e-200], energy: undefined },
  }))
  source.datasets[1].columns = source.datasets[0].columns
  source.experiment.polarization.beam2 = source.experiment.polarization.beam1
  const expected = structuredClone(source)
  const workspace = createScriptArrayWorkspace(source)
  source.datasets[0].polarization.beam1.sigma.re = 99
  source.sample.elementProfiles[0].f1 = 99
  const first = workspace.snapshot()
  expect(first).toEqual(expected)
  expect(first.datasets[0].polarization).toBe(first.experiment.polarization)
  expect(first.datasets[2].polarization.beam2).toBe(first.experiment.polarization.beam1)
  expect(first.datasets[1].columns).toBe(first.datasets[0].columns)
  expect(Object.is(first.datasets[0].energyShift, -0)).toBe(true)
  first.datasets[0].polarization.beam1.sigma.re = -17
  first.datasets[0].columns.qz.push(.03)
  first.fit.evolution.randomSeed = 812
  expect(workspace.snapshot()).toEqual(expected)
  workspace.replace(first)
  const refreshed = structuredClone(first)
  first.datasets[0].polarization.beam1.pi.im = 33
  first.scripts.parameters[0] = 55
  expect(workspace.snapshot()).toEqual(refreshed)
})

it('transfers completed state, revokes access, and refreshes without retaining result aliases', () => {
  const source = fixture()
  source.sample.elementProfiles[0].slabs = [{ thickness: 2, roughness: 0, density: 1 }]
  const workspace = createScriptArrayWorkspace(source)
  const thickness = workspace.arrays.get('thickness')!
  const element = workspace.elements[0]
  const energy = workspace.calculationEnergy()
  const state = workspace.beginHook()
  thickness.write(0, 17)
  const released = workspace.releaseSnapshot()
  expect(released.sample.layers[0].thickness).toBe(17)
  expect(source.sample.layers[0].thickness).not.toBe(17)
  for (const access of [() => thickness.read(0), () => thickness.write(0, 19),
    () => element.getFactor('f1'), () => element.setFactor('f1', 3),
    () => element.getSlab(0, 'density'), () => element.setSlab(0, 'density', 3),
    () => workspace.snapshot(), () => workspace.releaseSnapshot(), () => workspace.beginHook(),
    () => workspace.applyHook(state), () => workspace.calculationEnergy(),
    () => workspace.setLayerText(0, 'material', 'changed')]) {
    expect(access).toThrow('ownership was transferred')
  }
  const invalid = structuredClone(source)
  invalid.sample.layers.pop()
  expect(() => workspace.replace(invalid)).toThrow('structure changed')
  expect(() => workspace.snapshot()).toThrow('ownership was transferred')
  // The result owner cannot change the session's structural/energy bookkeeping.
  released.sample.layers.pop()
  released.sample.elementProfiles[0].element = 'changed'
  released.experiment.energy = 812
  workspace.replace(source)
  expect(workspace.calculationEnergy()).toBe(energy)
  expect(workspace.snapshot()).toEqual(source)
  thickness.write(0, 21)
  element.setFactor('f1', 13)
  expect(source.sample.elementProfiles[0].f1).toBe(26)
  expect(released.sample.layers[0].thickness).toBe(17)
  expect(released.sample.elementProfiles[0].f1).toBe(26)
})
