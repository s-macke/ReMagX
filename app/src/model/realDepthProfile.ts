import type { DepthProfile } from '../compute/ComputeService'
import type { OpticalTable } from '../import/tables'
import type { PreparedCompoundLayer } from './compoundLayers'
import type { Project } from './project'
import type { RealBeforeCalculation, RealCalculationEngine } from './realCalculation'
import { prepareRealLayerList } from './realLayerList'

export function realDepthProfile(original: Project, tables: OpticalTable[], engine: RealCalculationEngine,
  hook?: RealBeforeCalculation): DepthProfile {
  const stack = prepareRealLayerList(original, tables, engine, hook)
  return depthProfileFromLayers(stack.layers, stack.positions)
}

// Legacy plots omit the final ambient row. Smooth values average adjacent
// optical rows at their shared boundary; illustrated values retain actual slices.
export function depthProfileFromLayers(layers: readonly PreparedCompoundLayer[], positions: readonly number[]): DepthProfile {
  if (!layers.length || positions.length !== layers.length || !positions.every(Number.isFinite) ||
      positions.some((value, index) => index > 0 && value < positions[index - 1]) ||
      !layers.every(row => row.length === 8 && row.every(Number.isFinite))) throw new Error('Invalid prepared depth profile.')
  const count = Math.max(1, layers.length - 1)
  const values = (column: number) => {
    const result = Array.from({ length: count }, (_, index) => index === 0
      ? layers[0][column] : (layers[index][column] + layers[index + 1][column]) / 2)
    if (!result.every(Number.isFinite)) throw new Error('Nonfinite depth-profile average.')
    return result
  }
  return { engine: 'real', z: positions.slice(0, count), delta: values(2), beta: values(3), deltaMag: values(4), betaMag: values(5),
    segments: layers.slice(1, -1).map((row, index) => ({ start: positions[index], end: positions[index + 1],
      delta: row[2], beta: row[3], deltaMag: row[4], betaMag: row[5] })) }
}
