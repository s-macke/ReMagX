import { ComputeError } from './ComputeService'
import { depthProfile } from './mockPhysics'
import type { Layer, Project } from '../model/project'

// UI conversion preview only: the same fixed intervals as the mock profile display.
// Adaptive slicing, Lua and automatic database updates belong to the real engine.
export function mockLayerConversion(project: Project): Layer[] {
  if (project.sample.mode !== 'compound') throw new ComputeError('Switch to compound mode to replace the layer list.')
  const original = project.sample.layers
  const profile = depthProfile(project)
  let height = 0
  const tops = original.slice(0, -1).map((layer, index) => { if (index > 0) height += layer.thickness; return height })
  const clean = (layer: Layer): Layer => ({ ...structuredClone(layer), material: 'unknown', opticalTable: 'unknown', roughness: 0 })
  const slices = profile.segments!.map(segment => {
    const midpoint = (segment.start + segment.end) / 2
    const sourceIndex = tops.findIndex(top => midpoint <= top)
    const template = original[sourceIndex < 0 ? original.length - 1 : sourceIndex]
    return { ...clean(template), thickness: segment.end - segment.start,
      delta: segment.delta, beta: segment.beta, deltaMag: segment.deltaMag, betaMag: segment.betaMag }
  })
  return [{ ...clean(original[0]), thickness: 0 }, ...slices, { ...clean(original.at(-1)!), thickness: 0 }]
}
