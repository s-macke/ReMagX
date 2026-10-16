import type { ElementProfile, Project } from '../model/project'
import { ComputeError, type DensityProfiles } from './ComputeService'
import { erf, linspace } from './mockPhysics'

// UI-phase approximation only: a bounded grid and smooth slab windows respond to
// density, thickness and roughness edits. The real engine supplies legacy sampling/Lua.
export function mockDensityProfiles(project: Project): DensityProfiles {
  const elements = project.sample.elementProfiles
  if (project.sample.mode !== 'element' || !elements.length) throw new ComputeError('Define elements to show their density profiles.')
  const stacks = elements.map(element => {
    if (element.slabs.length < 2 || element.slabs.some(slab => [slab.thickness, slab.density, slab.roughness].some(value => !Number.isFinite(value) || value < 0))) {
      throw new ComputeError(`${element.element || 'Element'} needs valid substrate and ambient slabs to show its density profile.`)
    }
    let height = 0
    const boundaries = element.slabs.slice(0, -1).map((slab, index) => {
      if (index > 0) height += slab.thickness
      return height
    })
    return { element, boundaries, height }
  })
  const height = Math.max(...stacks.map(stack => stack.height))
  const roughness = Math.max(...elements.flatMap(element => element.slabs.map(slab => slab.roughness)))
  const end = height + 30 + 2 * roughness
  if (!Number.isFinite(end)) throw new ComputeError('The density profile depth range is too large.')
  const z = [...new Set([...linspace(-30, end, 401), ...stacks.flatMap(stack => stack.boundaries)])].sort((a, b) => a - b)
  return { z, elements: stacks.map(({ element, boundaries }) => ({
    name: element.element,
    density: z.map(depth => densityAt(element, boundaries, depth)),
    boundaries: boundaries.map(depth => ({ z: depth, density: densityAt(element, boundaries, depth) })),
  })) }
}

function densityAt(element: ElementProfile, boundaries: number[], depth: number): number {
  let density = 0
  let totalWeight = 0
  const transition = (index: number) => {
    const distance = depth - boundaries[index]
    const sigma = element.slabs[index].roughness
    return sigma > 0 ? 0.5 * (1 + erf(distance / (sigma * Math.SQRT2))) : distance === 0 ? 0.5 : distance > 0 ? 1 : 0
  }
  element.slabs.forEach((slab, index) => {
    const lower = index === 0 ? 1 : transition(index - 1)
    const upper = index === element.slabs.length - 1 ? 1 : 1 - transition(index)
    const weight = lower * upper
    density += weight * slab.density
    totalWeight += weight
  })
  return density / totalWeight
}
