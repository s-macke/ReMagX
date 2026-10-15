import { describe, expect, it } from 'vitest'
import { interpolateTable, parseOpticalTable, tableKindFromFileName } from './tables'

const coDb = `#	Optical Constants for Co
#Energy (eV)	Delta	Beta\r
31	0.27429	0.28288\r
30	0.28429	0.30277\r
32	0.26415	0.26486\r
`

describe('optical-constant tables', () => {
  it('reads a .db table, skipping comments and sorting by energy', () => {
    const table = parseOpticalTable(coDb, 'C:\\data\\Co.db')
    expect(table.name).toBe('Co')
    expect(table.kind).toBe('db')
    expect(table.energy).toEqual([30, 31, 32])
    expect(table.columns[0]).toEqual([0.28429, 0.27429, 0.26415])
    expect(table.warnings).toEqual([])
  })

  it('reads an .e table with 18 tensor columns', () => {
    const row = (e: number) => [e, ...Array.from({ length: 18 }, (_, i) => i)].join(' ')
    const table = parseOpticalTable(`${row(600)}\n${row(700)}\n`, 'Co.e')
    expect(table.columns).toHaveLength(18)
    expect(table.columns[17]).toEqual([17, 17])
  })

  it('skips malformed rows with a warning', () => {
    const table = parseOpticalTable('10 1 2\n11 x 3\n12 1\n', 'Cu.ff')
    expect(table.energy).toEqual([10])
    expect(table.warnings).toHaveLength(2)
  })

  it('interpolates linearly and clamps outside the range', () => {
    const table = parseOpticalTable(coDb, 'Co.db')
    expect(interpolateTable(table, 30.5)?.[0]).toBeCloseTo(0.27929, 12)
    expect(interpolateTable(table, 10)).toEqual([0.28429, 0.30277])
    expect(interpolateTable(table, 99)).toEqual([0.26415, 0.26486])
  })

  it('recognizes table files by extension', () => {
    expect(tableKindFromFileName('Fe.M')).toBe('m')
    expect(tableKindFromFileName('scan.dat')).toBeUndefined()
  })
})
