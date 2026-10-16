// Import of measured data from ASCII column files (legacy "Import Datasets", LoadASCIIForm) and
// ASCII exports (legacy "Save diagram data", "Export Table as ASCII").

import type { Dataset, Polarization, Project } from '../model/project'
import { wavelengthFromEnergy } from '../model/units'

export type Separator = 'whitespace' | 'tab' | 'comma' | 'semicolon'

export interface AsciiOptions {
  startLine: number // 1-based first line to read (legacy "start reading at line")
  separator: Separator
  decimalComma: boolean // numbers written as 1,5 instead of 1.5
}

// Meaning of a column; the legacy list plus theta, which is converted to qz.
export type ColumnRole = 'ignore' | 'qz' | 'theta' | 'reflectivity' | 'reflectivityPlus' | 'reflectivityMinus' | 'asymmetry' | 'energy' | 'electronYield'

export const columnRoleLabels: Record<ColumnRole, string> = {
  ignore: 'dummy',
  qz: 'Qz (1/Å)',
  theta: 'theta (°)',
  reflectivity: 'R0',
  reflectivityPlus: 'R+',
  reflectivityMinus: 'R−',
  asymmetry: 'Asym',
  energy: 'energy (eV)',
  electronYield: 'TEY',
}

export interface AsciiTable {
  rows: number[][]
  columnCount: number
  skippedLines: number[] // 1-based line numbers that were not numeric data
}

const splitters: Record<Separator, RegExp> = {
  whitespace: /\s+/,
  tab: /\t/,
  comma: /,/,
  semicolon: /;/,
}

export function parseAsciiTable(text: string, options: AsciiOptions): AsciiTable {
  const rows: number[][] = []
  const skippedLines: number[] = []
  text.split('\n').forEach((rawLine, index) => {
    const lineNumber = index + 1
    if (lineNumber < options.startLine) return
    const line = rawLine.replace(/\r$/, '').trim()
    if (line === '' || line.startsWith('#')) return
    const cells = line.split(splitters[options.separator]).map((cell) => cell.trim()).filter((cell) => cell !== '')
    const values = cells.map((cell) => Number(options.decimalComma ? cell.replace(',', '.') : cell))
    if (values.length === 0 || values.some((v) => !Number.isFinite(v))) {
      skippedLines.push(lineNumber)
      return
    }
    rows.push(values)
  })
  return { rows, columnCount: Math.max(0, ...rows.map((r) => r.length)), skippedLines }
}

// Guesses roles for a fresh file: first column qz, second R0, the rest ignored.
export function defaultColumnRoles(columnCount: number): ColumnRole[] {
  return Array.from({ length: columnCount }, (_, i) => (i === 0 ? 'qz' : i === 1 ? 'reflectivity' : 'ignore'))
}

export interface DatasetMetadata {
  title: string
  sourceFile: string
  energy: number
  polarization: Polarization
}

export function buildDataset(table: AsciiTable, roles: ColumnRole[], meta: DatasetMetadata): Dataset {
  const column = (role: ColumnRole) => {
    const index = roles.indexOf(role)
    return index < 0 ? undefined : table.rows.map((row) => row[index] ?? Number.NaN)
  }
  const theta = column('theta')
  const k0 = (2 * Math.PI) / wavelengthFromEnergy(meta.energy)
  const qz = column('qz') ?? theta?.map((t) => 2 * k0 * Math.sin((t * Math.PI) / 180))
  if (!qz) throw new Error('Choose a column for Qz or theta.')
  if (qz.some((v) => !Number.isFinite(v))) throw new Error('Some rows have no value in the Qz/theta column.')

  const columns: Dataset['columns'] = { qz }
  for (const role of ['energy', 'reflectivity', 'reflectivityPlus', 'reflectivityMinus', 'asymmetry', 'electronYield'] as const) {
    const values = column(role)
    if (values) columns[role] = values.map((v) => (Number.isFinite(v) ? v : 0))
  }
  return {
    title: meta.title,
    comment: '',
    sourceFile: meta.sourceFile,
    energy: meta.energy,
    energyShift: 0,
    angularResolution: 0,
    intensityScale: 1,
    intensityOffset: 0,
    qzShift: 0,
    errorWeight: 1,
    polarization: structuredClone(meta.polarization),
    active: true,
    columns,
  }
}

// --- exports --------------------------------------------------------------------------------

export interface ExportSeries {
  label: string
  x: number[]
  y: number[]
}

// Writes each curve as its own block "x<TAB>y" with a header, readable by plotting programs.
export function seriesToText(xLabel: string, series: ExportSeries[]): string {
  return series
    .map((s) => [`# ${s.label}`, `# ${xLabel}\t${s.label}`, ...s.x.map((x, i) => `${x}\t${s.y[i]}`)].join('\n'))
    .join('\n\n')
    .concat('\n')
}

// All curves of a plot (simulation on a shared x grid, measurements with their own x) as series.
export function diagramSeries(
  simulated: { x: number[]; series: { label: string; y: number[] }[] },
  measured: { label: string; curve: { x: number[]; y: number[] } }[],
): ExportSeries[] {
  return [
    ...simulated.series.map((s) => ({ label: s.label, x: simulated.x, y: s.y })),
    ...measured.map((m) => ({ label: m.label, x: m.curve.x, y: m.curve.y })),
  ]
}

export function layerTableToText(project: Project): string {
  const header = ['layer', 'thickness/A', 'db', 'material', 'density', 'delta', 'beta', 'sigma/A', 'deltam', 'betam', 'mag_gamma', 'mag_phi']
  const layers = project.sample.layers
  const rows = layers
    .map((l, i) => [
      i === 0 ? 'bulk' : i === layers.length - 1 ? 'air' : String(i),
      l.thickness,
      l.opticalTable || '-',
      l.material || '-',
      l.density,
      l.delta,
      l.beta,
      l.roughness,
      l.deltaMag,
      l.betaMag,
      l.magnetization.gamma,
      l.magnetization.phi,
    ])
    .reverse()
  return [`# ${header.join('\t')}`, ...rows.map((r) => r.join('\t'))].join('\n') + '\n'
}
