import type { FitDatasetPreview } from '../compute/ComputeService'
import type { CalculatedCurve } from './plotCoordinates'

// A fitted dataset preview is only valid for its own dataset, scan and available
// beams. Do not show an old curve under a newly selected view's axes or legend.
export function fitPreviewCurve(preview: FitDatasetPreview | undefined, datasetIndex: number | null,
  scan: 'qz' | 'energy', mode: 'monochromatic' | 'dichroic' | 'asymmetry'): CalculatedCurve | null {
  if (!preview || preview.datasetIndex !== datasetIndex || preview.scan !== scan ||
      mode !== 'monochromatic' && preview.beams !== 'dichroic') return null
  const x = scan === 'energy' ? preview.energy : preview.qz
  if (!x) return null
  if (mode === 'asymmetry') return { axis: scan, x, series: [{ label: 'fitted asymmetry', y: preview.asymmetry }], logScale: false, yLabel: 'asymmetry' }
  return { axis: scan, x, series: mode === 'monochromatic' ? [{ label: 'fitted R', y: preview.reflectivityPlus }]
    : [{ label: 'fitted R+', y: preview.reflectivityPlus }, { label: 'fitted R−', y: preview.reflectivityMinus }], logScale: true, yLabel: 'R' }
}
