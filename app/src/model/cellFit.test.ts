import { expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { cellIsFitted, toggleCellFit } from './cellFit'

it('toggles one target without mutating the project or unrelated parameters', () => {
  const project = createDefaultProject()
  const cell = { target: 'thickness', index: 1, elementIndex: null } as const
  const fitted = toggleCellFit(project, cell)
  expect(cellIsFitted(fitted, cell)).toBe(true)
  expect(project.fit.parameters).toHaveLength(0)
  expect(fitted.fit.parameters[0].value).toBe(project.sample.layers[1].thickness)
  const other = { ...cell, index: 2 }
  const both = toggleCellFit(fitted, other)
  const removed = toggleCellFit(both, cell)
  expect(removed.fit.parameters).toEqual([both.fit.parameters[1]])
  expect(removed.sample).toBe(project.sample)
  expect(toggleCellFit(project, { ...cell, index: 999 })).toBe(project)
})

it('keeps parameters for different elements separate and removes duplicate target entries', () => {
  const project = createDefaultProject()
  const cell = { target: 'elementDensity', index: 1, elementIndex: 0 } as const
  const parameter = { ...cell, value: 1, step: 0.05, lowerBound: 0, upperBound: 2 }
  project.fit.parameters = [parameter, { ...parameter }, { ...parameter, elementIndex: 1 }]
  const result = toggleCellFit(project, cell)
  expect(result.fit.parameters).toEqual([{ ...parameter, elementIndex: 1 }])
})
