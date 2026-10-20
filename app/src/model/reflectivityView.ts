import type { ReflectivityCurve } from '../compute/ComputeService'
import type { CalculatedCurve } from './plotCoordinates'
import type { Project } from './project'

export function reflectivityPlot(curve: ReflectivityCurve, project: Project): CalculatedCurve & { scriptMessages?: string[] } {
  if (curve.axis === 'depth') return { scriptMessages: curve.scriptMessages, axis: 'depth', x: curve.qz,
    series: [{ label: 'simulated Fourier magnitude', y: curve.reflectivity }],
    measured: curve.measuredFourier ? [{ label: 'measured Fourier magnitude', curve: {
      x: curve.measuredFourier.qz, y: curve.measuredFourier.reflectivity } }] : [],
    logScale: !project.calculation.postProcessing.multiplyByQz4, yLabel: 'Fourier magnitude' }
  return { scriptMessages: curve.scriptMessages, axis: 'qz', x: curve.qz,
    series: [{ label: 'simulated R', y: curve.reflectivity }], logScale: true, yLabel: 'R' }
}
