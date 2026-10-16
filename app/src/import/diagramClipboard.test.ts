import { expect, it } from 'vitest'
import { diagramClipboardText } from './asciiData'

it('copies independent x/y columns without dropping longer curves or inventing missing points', () => {
  expect(diagramClipboardText([
    { label: 'simulation', x: [1], y: [0.5] },
    { label: 'measured', x: [2, 3], y: [0.4, 0.3] },
    { label: 'empty', x: [], y: [] },
  ])).toBe('1\t0.5\t2\t0.4\r\n\t\t3\t0.3\r\n')
  expect(diagramClipboardText([])).toBe('')
})
