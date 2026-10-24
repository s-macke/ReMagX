import { expect, it } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { applyElementConversion, convertMaterialElements, formulaContributions } from './materialElements'
import { initialState, reducer } from '../state/appState'

it('parses legacy integer formulas, reports annotations/repeats, and rejects unsupported syntax', () => {
  const oxide = formulaContributions('Al2O3', 3.9)
  expect(oxide.contributions.map(value => value.symbol)).toEqual(['Al', 'O'])
  expect(oxide.contributions[1].density / oxide.contributions[0].density).toBeCloseTo(1.5)
  expect(formulaContributions('Al2O3', 7.8).contributions[0].density).toBe(oxide.contributions[0].density * 2)
  expect(formulaContributions('Fe[1]2Fe', 1).warnings.join(' ')).toContain('overwrite')
  expect(formulaContributions('Fe[1]2Fe', 1).warnings.join(' ')).toContain('ignored')
  for (const formula of ['Fe0', 'Al(OH)3', 'Co0.5Ni0.5', 'Xx', 'Tl', 'Co1000']) expect(() => formulaContributions(formula, 1)).toThrow()
})

it('builds aligned stacks, preserves source geometry, and reports skipped material rows', () => {
  const project = createDefaultProject()
  project.sample.layers = [createLayer({ material: 'Si', density: 2.3, roughness: 2 }), createLayer({ material: 'Al2O3', density: 3.9, thickness: 20, roughness: 3 }), createLayer({ material: 'bad', density: 1, thickness: 5 }), createLayer()]
  const before = structuredClone(project)
  const result = convertMaterialElements(project)
  expect(result.elements.map(element => element.element)).toEqual(['Si', 'Al', 'O'])
  expect(result.elements.every(element => element.slabs.length === 4 && element.f1 === 0 && element.slabs[1].thickness === 20 && element.slabs[1].roughness === 3)).toBe(true)
  expect(result.elements[0].slabs[1].density).toBe(0)
  expect(result.warnings.join(' ')).toContain('Layer 2 skipped')
  expect(project).toEqual(before)
})

it('replaces only element data and its fit references atomically, with stale guards and undo', () => {
  const state = initialState()
  state.project.fit.parameters = ['elementF1', 'elementDensity', 'delta'].map(target => ({ target: target as 'elementF1' | 'elementDensity' | 'delta', index: 1, elementIndex: 0, value: 1, step: 1, lowerBound: 0, upperBound: 2 }))
  const result = convertMaterialElements(state.project)
  const conversion = applyElementConversion(state.project, result)
  expect(conversion.removedFits).toBe(2)
  expect(conversion.project.sample.layers).toBe(state.project.sample.layers)
  const action = { type: 'applyElementConversion' as const, source: state.project, epoch: state.fitEpoch, result }
  const next = reducer(state, action)
  expect(next.project.sample.mode).toBe('element')
  expect(next.fitEpoch).toBeGreaterThan(state.fitEpoch)
  expect(next.history.past).toHaveLength(1)
  expect(reducer(next, { type: 'undo' }).project).toBe(state.project)
  expect(reducer(next, action).project).toBe(next.project)
  expect(() => applyElementConversion(state.project, { elements: [], warnings: [] })).toThrow('No valid element stacks')
})


it('expands repeated materials into independent element slabs without replacing stored compound layers', () => {
  const state = initialState()
  const project = state.project
  project.sample.layers = [createLayer({ material: 'Si', density: 2.3 }),
    createLayer({ material: 'Fe', density: 7, thickness: 10, roughness: 1 }),
    createLayer({ material: 'Co', density: 8, thickness: 20, roughness: 2 }), createLayer()]
  project.sample.multilayer = { enabled: true, pattern: '2*(1,2)' }
  const before = structuredClone(project)
  const result = convertMaterialElements(project)
  expect(result.elements.map(element => element.element)).toEqual(['Si', 'Fe', 'Co'])
  for (const element of result.elements) {
    expect(element.slabs.map(slab => slab.thickness)).toEqual([0, 10, 20, 10, 20, 0])
    expect(element.slabs.map(slab => slab.roughness)).toEqual([0, 1, 2, 1, 2, 0])
    expect(element.slabs[1]).not.toBe(element.slabs[3])
  }
  const iron = result.elements[1].slabs
  expect(iron.map(slab => slab.density > 0)).toEqual([false, true, false, true, false, false])
  expect(iron[1].density).toBe(iron[3].density)
  const next = reducer(state, { type: 'applyElementConversion', source: project, epoch: state.fitEpoch, result })
  expect(next.project.sample.layers).toBe(project.sample.layers)
  expect(next.project.sample.multilayer).toEqual(before.sample.multilayer)
  expect(next.project.sample.elementProfiles[0].slabs).toHaveLength(6)
  expect(next.project.sample.mode).toBe('element')
  expect(reducer(next, { type: 'undo' }).project).toEqual(before)
  expect(project).toEqual(before)
  result.elements[0].slabs[1].density = 123
  expect(next.project.sample.elementProfiles[0].slabs[1].density).not.toBe(123)
})

it('rejects invalid multilayer expansion and mismatched conversion results without modifying the project', () => {
  const project = createDefaultProject()
  const result = convertMaterialElements(project)
  project.sample.multilayer = { enabled: true, pattern: '2*(1)' }
  const before = structuredClone(project)
  expect(() => applyElementConversion(project, result)).toThrow('No valid element stacks')
  project.sample.multilayer.pattern = '2*(999)'
  const invalid = structuredClone(project)
  expect(() => convertMaterialElements(project)).toThrow('out of range')
  expect(project).toEqual(invalid)
  project.sample.multilayer = before.sample.multilayer
  expect(project).toEqual(before)
})
