import type { LayerSpectrum } from '../compute/ComputeService'
import type { CalculatedCurve } from './plotCoordinates'

export type SpectrumView = 'scatteringFactors' | 'opticalSpectrum' | 'magneticSpectrum'

export function spectrumPlot(spectrum: LayerSpectrum, view: SpectrumView): CalculatedCurve & { scriptMessages?: string[] } {
  const labels = view === 'scatteringFactors' ? ['f1', 'f2'] : view === 'magneticSpectrum' ? ['δm', 'βm'] : ['δ', 'β']
  return {
    axis: 'energy', x: spectrum.energy, logScale: false,
    series: [{ label: labels[0], y: spectrum.first }, { label: labels[1], y: spectrum.second }],
    yLabel: `${labels.join(' / ')} (${spectrum.engine === 'real' ? 'real' : 'mock preview'})`,
    scriptMessages: spectrum.scriptMessages,
  }
}
