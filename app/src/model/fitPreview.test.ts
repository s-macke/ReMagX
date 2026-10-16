import { expect, it } from 'vitest'
import type { FitDatasetPreview } from '../compute/ComputeService'
import { fitPreviewCurve } from './fitPreview'

const preview: FitDatasetPreview = { datasetIndex: 1, scan: 'qz', beams: 'dichroic', qz: [.01, .02],
  reflectivityPlus: [3, 2], reflectivityMinus: [1, 1], asymmetry: [.5, 1 / 3] }
it('uses the evaluated coordinates and correct series/scales for each matching view', () => {
  expect(fitPreviewCurve(preview, 1, 'qz', 'monochromatic')).toMatchObject({ axis: 'qz', x: preview.qz,
    series: [{ label: 'fitted R', y: [3, 2] }], logScale: true })
  expect(fitPreviewCurve(preview, 1, 'qz', 'dichroic')?.series.map(series => series.y)).toEqual([[3, 2], [1, 1]])
  expect(fitPreviewCurve({ ...preview, scan: 'energy', energy: [640, 650] }, 1, 'energy', 'asymmetry'))
    .toMatchObject({ axis: 'energy', x: [640, 650], logScale: false, yLabel: 'asymmetry' })
})
it('does not mislabel absent, differently selected or incompatible previews', () => {
  expect(fitPreviewCurve(undefined, 1, 'qz', 'monochromatic')).toBeNull()
  expect(fitPreviewCurve(preview, 0, 'qz', 'monochromatic')).toBeNull()
  expect(fitPreviewCurve(preview, null, 'qz', 'monochromatic')).toBeNull()
  expect(fitPreviewCurve(preview, 1, 'energy', 'monochromatic')).toBeNull()
  expect(fitPreviewCurve({ ...preview, beams: 'monochromatic' }, 1, 'qz', 'asymmetry')).toBeNull()
  expect(fitPreviewCurve({ ...preview, scan: 'energy' }, 1, 'energy', 'dichroic')).toBeNull()
})
