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
