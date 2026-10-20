import type { DepthProfile } from '../compute/ComputeService'
import type { CalculatedCurve } from './plotCoordinates'

export function profilePlot(profile: DepthProfile, magnetic: boolean, illustrate: boolean): CalculatedCurve {
  const first = magnetic ? 'deltaMag' : 'delta'
  const second = magnetic ? 'betaMag' : 'beta'
  const segments = illustrate ? profile.segments : undefined
  const initial = profile.engine === 'real' && segments ? [0] : []
  return {
    axis: 'z', logScale: false,
    yLabel: `${magnetic ? 'magnetic optical' : 'optical'} constants (${profile.engine === 'real' ? 'real' : 'mock'}${segments ? profile.engine === 'real' ? ' slices' : ' intervals' : ''})`,
    x: segments ? [...initial.map(() => profile.z[0]), ...segments.flatMap(segment => [segment.start, segment.start, segment.start, segment.end])] : profile.z,
    series: [
      { label: magnetic ? 'δm' : 'δ', y: segments ? [...initial.map(() => profile[first][0]), ...segments.flatMap(segment => [segment[first], 0, segment[first], segment[first]])] : profile[first] },
      { label: magnetic ? 'βm' : 'β', y: segments ? [...initial.map(() => profile[second][0]), ...segments.flatMap(segment => Array(4).fill(segment[second]))] : profile[second] },
    ],
  }
}
