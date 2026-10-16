import type { CalculatedCurve } from './plotCoordinates'

export const tensorComponents = ['xx', 'xy', 'xz', 'yx', 'yy', 'yz', 'zx', 'zy', 'zz'] as const
export type TensorGroup = 'diagonal' | 'upper' | 'lower'
export interface TensorPreview {
  energy: number[]
  tensors: { re: number; im: number }[][] // row-major 3×3 at each energy
  source: 'table' | 'scalar'
}
const groups = { diagonal: [0, 4, 8], upper: [1, 2, 5], lower: [3, 6, 7] } as const
export function tensorPlot(preview: TensorPreview, group: TensorGroup): CalculatedCurve {
  return { axis: 'energy', x: preview.energy, logScale: false, yLabel: `ε ${group} (mock preview)`,
    series: groups[group].flatMap(index => [
      { label: `${group === 'diagonal' ? '1 − ' : ''}Re ε_${tensorComponents[index]}`, y: preview.tensors.map(tensor => group === 'diagonal' ? 1 - tensor[index].re : tensor[index].re) },
      { label: `Im ε_${tensorComponents[index]}`, y: preview.tensors.map(tensor => tensor[index].im) },
    ]),
  }
}
