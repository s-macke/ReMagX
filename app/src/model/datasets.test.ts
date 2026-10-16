import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { deleteDataset, measuredSeries, moveDataset } from './datasets'
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

describe('measured series', () => {
  it('selects the columns of a display mode and applies scale and shift', () => {
    const project = withDatasets(['scan'], 0)
    project.datasets[0] = {
      ...project.datasets[0],
      intensityScale: 2,
      qzShift: 0.01,
      columns: { qz: [0.1, 0.2], reflectivity: [0.5, 0.25], asymmetry: [0.1, -0.1] },
    }
    expect(measuredSeries(project, 'monochromatic', 'qz')).toEqual([{ label: 'measured R', curve: { x: [0.11, 0.21000000000000002], y: [1, 0.5] } }])
    expect(measuredSeries(project, 'asymmetry', 'qz')[0].curve.y).toEqual([0.1, -0.1])
    expect(measuredSeries(project, 'dichroic', 'qz')).toEqual([])
  })
})
