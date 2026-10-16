import { expect, it } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { compoundLayerIndices, prepareCompoundLayers } from './compoundLayers'

it('expands nested legacy sequences with implicit outer media and explicit duplicates', () => {
  expect(compoundLayerIndices(5, '2*(1, 2*(2,3))')).toEqual([0, 1, 2, 3, 2, 3, 1, 2, 3, 2, 3, 4])
  expect(compoundLayerIndices(5, '0, 3*(1, 2), 4')).toEqual([0, 0, 1, 2, 1, 2, 1, 2, 4, 4])
  expect(compoundLayerIndices(5, '')).toEqual([0, 4])
  expect(compoundLayerIndices(5, '0*(1,2),3')).toEqual([0, 3, 4])
  expect(compoundLayerIndices(5, '999999999999*()')).toEqual([0, 4])
})

it('retains defined legacy character handling and rejects invalid or excessive expansion', () => {
  expect(compoundLayerIndices(15, '1a2')).toEqual([0, 12, 14])
  expect(compoundLayerIndices(5, '1)2')).toEqual([0, 1, 4])
  expect(compoundLayerIndices(5, '1\0,2')).toEqual([0, 1, 4])
  for (const pattern of ['5', '2* (1)', '2*(1', '9007199254740992*(1)', '100000*(1)']) {
    expect(() => compoundLayerIndices(5, pattern)).toThrow()
  }
  expect(() => compoundLayerIndices(5, '1*('.repeat(129) + '1' + ')'.repeat(129))).toThrow('nesting')
  expect(compoundLayerIndices(5, '2*(1,2)', 6)).toHaveLength(6)
  expect(() => compoundLayerIndices(5, '2*(1,2)', 5)).toThrow('limit')
  expect(() => compoundLayerIndices(5, '0*(9)')).toThrow('out of range')
})

it('prepares independent substrate-first rows without density scaling or global-direction substitution', () => {
  const project = createDefaultProject()
  project.sample.layers = [createLayer({ delta: .01, density: 20, roughness: 3 }),
    createLayer({ thickness: 7, delta: .002, beta: .003, deltaMag: .004, betaMag: .005,
      magnetization: { gamma: 12, phi: 34 } }), createLayer()]
  project.calculation.magnetization.direction = { gamma: 56, phi: 78 }
  project.sample.multilayer = { enabled: true, pattern: '2*(1)' }
  const before = structuredClone(project)
  const rows = prepareCompoundLayers(project)
  expect(rows).toHaveLength(4)
  expect(rows[0][2]).toBe(.01)
  expect(rows[0][1]).toBe(3)
  expect(rows[1]).toEqual([7, 0, .002, .003, .004, .005, 12, 34])
  expect(rows[2]).toEqual(rows[1])
  rows[1][0] = 100
  expect(rows[2][0]).toBe(7)
  expect(project).toEqual(before)
  project.sample.multilayer.enabled = false
  expect(prepareCompoundLayers(project)).toHaveLength(3)
  project.sample.mode = 'element'
  expect(() => prepareCompoundLayers(project)).toThrow('Element-mode')
  project.sample.mode = 'compound'
  project.calculation.roughnessModel = 'segmentation'
  expect(() => prepareCompoundLayers(project)).toThrow('segmentation')
})
