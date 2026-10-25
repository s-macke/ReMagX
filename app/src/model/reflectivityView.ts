import type { ReflectivityCurve } from '../compute/ComputeService'
import type { CalculatedCurve } from './plotCoordinates'

export function reflectivityPlot(curve: ReflectivityCurve): CalculatedCurve & { scriptMessages?: string[] } {
  return { scriptMessages: curve.scriptMessages, axis: 'qz', x: curve.qz,
    series: [{ label: 'simulated R', y: curve.reflectivity }], logScale: true, yLabel: 'R' }
}
