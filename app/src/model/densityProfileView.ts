import type { DensityProfiles } from '../compute/ComputeService'
import type { CalculatedCurve } from './plotCoordinates'

export function densityProfilePlot(profiles: DensityProfiles): CalculatedCurve & { scriptMessages?: string[] } {
  return { axis: 'z', x: profiles.z, series: profiles.elements.map(element => ({ label: element.name, y: element.density })),
    logScale: false, yLabel: `density (${profiles.engine === 'real' ? 'real' : 'mock'})`, scriptMessages: profiles.scriptMessages,
    boundaryMarks: profiles.elements.flatMap((element, seriesIndex) => element.boundaries.map(boundary => ({ x: boundary.z, y: boundary.density, seriesIndex }))),
  }
}
