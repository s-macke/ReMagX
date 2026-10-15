import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { deleteDataset, moveDataset } from './datasets'
import type { Dataset, Project } from './project'

function withDatasets(titles: string[], active: number | null): Project {
  const project = createDefaultProject()
  project.datasets = titles.map(
    (title): Dataset => ({
      title,
      comment: '',
      sourceFile: '',
      energy: 700,
      energyShift: 0,
      angularResolution: 0,
      intensityScale: 1,
      intensityOffset: 0,
      qzShift: 0,
      errorWeight: 1,
      polarization: project.experiment.polarization,
      active: true,
      columns: { qz: [0.1] },
    }),
  )
  project.activeDatasetIndex = active
  return project
}

describe('dataset list operations', () => {
  it('moves a dataset and keeps the active one selected', () => {
    const moved = moveDataset(withDatasets(['a', 'b', 'c'], 0), 0, 1)
    expect(moved.datasets.map((d) => d.title)).toEqual(['b', 'a', 'c'])
    expect(moved.activeDatasetIndex).toBe(1)
  })

  it('ignores moves past the ends', () => {
    const project = withDatasets(['a', 'b'], 0)
    expect(moveDataset(project, 0, -1)).toBe(project)
  })

  it('deletes datasets and adjusts the active index', () => {
    expect(deleteDataset(withDatasets(['a', 'b', 'c'], 2), 0).activeDatasetIndex).toBe(1)
    expect(deleteDataset(withDatasets(['a', 'b'], 1), 1).activeDatasetIndex).toBe(0)
    expect(deleteDataset(withDatasets(['a'], 0), 0).activeDatasetIndex).toBeNull()
  })
})
