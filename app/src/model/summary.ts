import type { Dataset } from './project'

export interface SummaryDataset {
  datasetIndex: number
  title: string
  scan: 'qz' | 'energy'
  mode: 'monochromatic' | 'dichroic' | 'asymmetry'
  weightedError: number
  measurement: Dataset['columns']
  calculated: Dataset['columns']
}

export function summarySeries(row: SummaryDataset) {
  const quantities = row.mode === 'asymmetry' ? ['asymmetry'] as const
    : row.mode === 'dichroic' ? ['reflectivityPlus', 'reflectivityMinus'] as const : ['reflectivity'] as const
  const names = { reflectivity: 'R', reflectivityPlus: 'R+', reflectivityMinus: 'R−', asymmetry: 'asymmetry' }
  return quantities.flatMap(quantity => (['calculated', 'measurement'] as const).map((source, index) => ({
    label: `${index ? 'measured' : 'simulated'} ${names[quantity]}`,
    color: quantity === 'reflectivityMinus' ? (index ? '#a573c2' : '#2858bd') : (index ? '#218c54' : '#c0392b'),
    x: row[source][row.scan] ?? [], y: row[source][quantity] ?? [],
  })))
}

export function summaryRange(rows: SummaryDataset[], axis: 'x' | 'y', scan: 'qz' | 'energy', positive = false): [number, number] | undefined {
  let low = Infinity, high = -Infinity
  for (const row of rows) if (row.scan === scan) for (const series of summarySeries(row)) {
    for (const value of axis === 'x' ? series.x : series.y) {
      if (Number.isFinite(value) && (!positive || value > 0)) { low = Math.min(low, value); high = Math.max(high, value) }
    }
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined
  if (low === high) return positive ? [low / 2, high * 2] : [low - (Math.abs(low) || 1) * .05, high + (Math.abs(high) || 1) * .05]
  return [low, high]
}

// Export the full snapshot, without display rounding, including columns not selected for display.
export function summaryText(rows: SummaryDataset[]): string {
  return rows.map(row => {
    const columns: { name: string; values: number[] }[] = []
    for (const source of ['calculated', 'measurement'] as const) {
      for (const key of ['energy', 'qz', 'reflectivity', 'asymmetry', 'reflectivityPlus', 'reflectivityMinus', 'electronYield'] as const) {
        const values = row[source][key]
        if (values?.length) columns.push({ name: `${source} ${key}`, values })
      }
    }
    const count = Math.max(0, ...columns.map(column => column.values.length))
    return [`# Dataset ${row.datasetIndex + 1}: ${row.title.replace(/[\r\n\t]/g, ' ')}`, `# Weighted error: ${row.weightedError}`,
      columns.map(column => column.name).join('\t'),
      ...Array.from({ length: count }, (_, i) => columns.map(column => column.values[i] === undefined ? '' : String(column.values[i])).join('\t'))].join('\n')
  }).join('\n\n')
}
