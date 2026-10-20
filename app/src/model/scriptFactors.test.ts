import { expect, it, vi } from 'vitest'
import { createScriptFactorLookup } from './scriptFactors'
import { parseOpticalTable } from '../import/tables'
import type { ScriptElementBinding } from './scriptArrays'

it('advances Getff tensor lookup history while writing only the four scalar factors', () => {
  const tables = [parseOpticalTable('100 26 2\n200 26 2', 'Fe.ff'),
    parseOpticalTable([150, ...Array(18).fill(9)].join(' '), 'Fe.F')]
  const cursors = new Map()
  const lookup = vi.fn((table, _energy, cursor) => ({ values: table.kind === 'f' ? new Float64Array(18) : new Float64Array([26, 2]), cursor: cursor + 1 }))
  const element: ScriptElementBinding = { name: 'Fe', getFactor: vi.fn(), setFactor: vi.fn(), getSlab: vi.fn(), setSlab: vi.fn() }
  const refresh = createScriptFactorLookup(tables, lookup, cursors)
  refresh(element, 125); refresh(element, 175)
  expect(lookup.mock.calls.map(([table, , cursor]) => [table.kind, cursor])).toEqual([['ff', 0], ['f', 0], ['ff', 1], ['f', 1]])
  expect(element.setFactor).toHaveBeenCalledTimes(8)
  expect(element.setFactor).toHaveBeenCalledWith('f1', 26)
  expect(element.setFactor).toHaveBeenCalledWith('f1Mag', 0)
  refresh(element, 250)
  expect(lookup).toHaveBeenCalledTimes(4)
})
