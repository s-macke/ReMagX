import { expect, it } from 'vitest'
import { tensorPlot, type TensorPreview } from './tensorView'

it('groups all nine components and uses 1 − real only for the three diagonal curves', () => {
  const preview: TensorPreview = { energy: [700, 800], source: 'table', tensors: [0, 1].map(offset => Array.from({ length: 9 }, (_, index) => ({ re: index + offset, im: -index - offset }))) }
  const original = structuredClone(preview)
  const diagonal = tensorPlot(preview, 'diagonal')
  expect(diagonal.series.map(series => series.label)).toEqual(['1 − Re ε_xx', 'Im ε_xx', '1 − Re ε_yy', 'Im ε_yy', '1 − Re ε_zz', 'Im ε_zz'])
  expect(diagonal.series[2].y).toEqual([-3, -4])
  expect(tensorPlot(preview, 'upper').series[4]).toEqual({ label: 'Re ε_yz', y: [5, 6] })
  expect(tensorPlot(preview, 'lower').series[2]).toEqual({ label: 'Re ε_zx', y: [6, 7] })
  expect(preview).toEqual(original)
})
