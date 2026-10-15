import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { canRemoveSlab, insertSlabAbove, removeSlab, updateSlab } from './elements'
import type { Project } from './project'

function elementProject(): Project {
  const project = createDefaultProject()
  project.sample.mode = 'element'
  project.sample.elementProfiles = [
    {
      element: 'Co',
      f1: 1,
      f2: 2,
      f1Mag: 0,
      f2Mag: 0,
      slabs: [
        { thickness: 0, density: 0.1, roughness: 3 },
        { thickness: 20, density: 0.15, roughness: 3 },
        { thickness: 0, density: 0, roughness: 0 },
      ],
    },
  ]
  return project
}

describe('element slabs', () => {
  it('inserts a copy above the selected slab', () => {
    const { project, inserted } = insertSlabAbove(elementProject(), 0, 1)
    expect(inserted).toBe(2)
    expect(project.sample.elementProfiles[0].slabs[2]).toEqual({ thickness: 20, density: 0.15, roughness: 3 })
  })

  it('keeps substrate and ambient slabs', () => {
    const project = elementProject()
    expect(canRemoveSlab(project, 0, 0)).toBe(false)
    expect(canRemoveSlab(project, 0, 2)).toBe(false)
    expect(removeSlab(project, 0, 1).sample.elementProfiles[0].slabs).toHaveLength(2)
  })

  it('updates a slab without changing the input', () => {
    const project = elementProject()
    const changed = updateSlab(project, 0, 1, { density: 0.2 })
    expect(changed.sample.elementProfiles[0].slabs[1].density).toBe(0.2)
    expect(project.sample.elementProfiles[0].slabs[1].density).toBe(0.15)
  })
})
