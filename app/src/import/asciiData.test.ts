import { describe, expect, it } from 'vitest'
import { createCircularPolarization, createDefaultProject } from '../model/defaults'
import { buildDataset, layerTableToText, parseAsciiTable, seriesToText } from './asciiData'

const meta = { title: 'scan', sourceFile: 'scan.dat', energy: 900, polarization: createCircularPolarization() }

describe('ASCII data import', () => {
  it('reads whitespace columns from a start line, skipping text lines', () => {
    const table = parseAsciiTable('header line\n0.01 0.9 1\n0.02\t0.8 2\r\nnot data\n', { startLine: 2, separator: 'whitespace', decimalComma: false })
    expect(table.rows).toEqual([
      [0.01, 0.9, 1],
      [0.02, 0.8, 2],
    ])
    expect(table.skippedLines).toEqual([4])
    expect(table.columnCount).toBe(3)
  })

  it('handles semicolons with decimal commas', () => {
    const table = parseAsciiTable('0,01;0,5\n', { startLine: 1, separator: 'semicolon', decimalComma: true })
    expect(table.rows).toEqual([[0.01, 0.5]])
  })

  it('builds a dataset from the chosen column roles', () => {
    const table = parseAsciiTable('900 0.1 0.5\n901 0.1 0.4\n', { startLine: 1, separator: 'whitespace', decimalComma: false })
    const dataset = buildDataset(table, ['energy', 'qz', 'reflectivity'], meta)
    expect(dataset.columns).toEqual({ qz: [0.1, 0.1], energy: [900, 901], reflectivity: [0.5, 0.4] })
    expect(dataset.active).toBe(true)
  })

  it('converts theta in degrees to qz with the dataset energy', () => {
    const table = parseAsciiTable('30 0.5\n', { startLine: 1, separator: 'whitespace', decimalComma: false })
    const dataset = buildDataset(table, ['theta', 'reflectivity'], meta)
    const k0 = (2 * Math.PI) / (12398.326 / 900)
    expect(dataset.columns.qz[0]).toBeCloseTo(2 * k0 * 0.5, 12)
  })

  it('requires a qz or theta column', () => {
    const table = parseAsciiTable('1 2\n', { startLine: 1, separator: 'whitespace', decimalComma: false })
    expect(() => buildDataset(table, ['reflectivity', 'ignore'], meta)).toThrow(/Qz or theta/)
  })
})

describe('ASCII export', () => {
  it('writes curve blocks with headers', () => {
    expect(seriesToText('qz', [{ label: 'R', x: [0.1, 0.2], y: [1, 0.5] }])).toBe('# R\n# qz\tR\n0.1\t1\n0.2\t0.5\n')
  })

  it('writes the layer table top-down like the UI', () => {
    const lines = layerTableToText(createDefaultProject()).trim().split('\n')
    expect(lines).toHaveLength(15)
    expect(lines[1].startsWith('air\t0\tvacuum')).toBe(true)
    expect(lines.at(-1)?.startsWith('bulk')).toBe(true)
  })
})
