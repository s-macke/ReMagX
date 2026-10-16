import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { applyMagnetizationToAllLayers, canRemoveLayer, insertLayerAbove, removeLayer, updateLayer } from './layers'

describe('layer editing', () => {
  it('updates one layer without touching the input project', () => {
    const project = createDefaultProject()
    const changed = updateLayer(project, 2, { thickness: 55 })
    expect(changed.sample.layers[2].thickness).toBe(55)
    expect(project.sample.layers[2].thickness).toBe(60)
  })

  it('inserts a copy above the selected layer', () => {
    const project = createDefaultProject()
    const { project: changed, inserted } = insertLayerAbove(project, 1)
    expect(inserted).toBe(2)
    expect(changed.sample.layers).toHaveLength(15)
    expect(changed.sample.layers[2]).toEqual(project.sample.layers[1])
    expect(changed.sample.layers[2]).not.toBe(project.sample.layers[1])
  })

  it('inserts below the ambient medium when the ambient is selected', () => {
    const project = createDefaultProject()
    const { project: changed, inserted } = insertLayerAbove(project, 13)
    expect(inserted).toBe(13)
    expect(changed.sample.layers.at(-1)?.opticalTable).toBe('vacuum')
  })

  it('never removes the substrate or the ambient medium', () => {
    const project = createDefaultProject()
    expect(canRemoveLayer(project, 0)).toBe(false)
    expect(canRemoveLayer(project, 13)).toBe(false)
    expect(removeLayer(project, 0)).toBe(project)
    expect(removeLayer(project, 5).sample.layers).toHaveLength(13)
  })
})

describe('magnetization', () => {
  it('applies one direction to all layers', () => {
    const project = applyMagnetizationToAllLayers(createDefaultProject(), { gamma: 0, phi: 0 })
    expect(project.sample.layers.every((l) => l.magnetization.gamma === 0 && l.magnetization.phi === 0)).toBe(true)
  })
})
