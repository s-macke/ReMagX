// Readers for legacy optical-constant tables. Each file is a whitespace-separated ASCII table with
// the photon energy (eV) in the first column; lines starting with "#" are comments. The legacy
// program looked them up by material name plus extension (MaterialConstants.cpp).

export const tableKinds = {
  db: { columns: ['delta', 'beta'], description: 'optical constants' },
  m: { columns: ['deltaMag', 'betaMag'], description: 'magnetic optical constants' },
  e: {
    // complex dielectric tensor, row-major: xx, xy, xz, yx, yy, yz, zx, zy, zz (re, im each)
    columns: ['xx', 'xy', 'xz', 'yx', 'yy', 'yz', 'zx', 'zy', 'zz'].flatMap((c) => [`${c}_re`, `${c}_im`]),
    description: 'dielectric tensor',
  },
  ff: { columns: ['f1', 'f2'], description: 'atomic form factors' },
  ffm: { columns: ['f1Mag', 'f2Mag'], description: 'magnetic form factors' },
} as const

export type TableKind = keyof typeof tableKinds

export interface OpticalTable {
  name: string // material or element name (file name without extension)
  kind: TableKind
  energy: number[] // ascending
  columns: number[][] // columns[c][i] belongs to energy[i]
  warnings: string[]
}

export function tableKindFromFileName(fileName: string): TableKind | undefined {
  const extension = fileName.split('.').pop()?.toLowerCase()
  return extension && extension in tableKinds ? (extension as TableKind) : undefined
}

export function parseOpticalTable(content: string, fileName: string): OpticalTable {
  const kind = tableKindFromFileName(fileName)
  if (!kind) throw new Error(`"${fileName}" is not an optical-constant table (.db, .m, .e, .ff, .ffm).`)
  const width = tableKinds[kind].columns.length
  const warnings: string[] = []
  const rows: number[][] = []

  content.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) return
    const values = line.split(/\s+/).map(Number)
    if (values.length < width + 1 || values.slice(0, width + 1).some((v) => !Number.isFinite(v))) {
      warnings.push(`Line ${index + 1}: expected ${width + 1} numbers, skipped.`)
      return
    }
    if (values.length > width + 1) warnings.push(`Line ${index + 1}: extra columns ignored.`)
    rows.push(values.slice(0, width + 1))
  })
  rows.sort((a, b) => a[0] - b[0]) // the legacy program sorted tables by energy as well

  return {
    name: fileName.replace(/\.[^.]+$/, '').split(/[\\/]/).pop() ?? fileName,
    kind,
    energy: rows.map((r) => r[0]),
    columns: Array.from({ length: width }, (_, c) => rows.map((r) => r[c + 1])),
    warnings,
  }
}

// Linear interpolation of all columns at the given energy; values are held constant outside
// the table range. Returns undefined for an empty table.
export function interpolateTable(table: OpticalTable, energy: number): number[] | undefined {
  const e = table.energy
  if (e.length === 0) return undefined
  if (energy <= e[0]) return table.columns.map((c) => c[0])
  if (energy >= e[e.length - 1]) return table.columns.map((c) => c[e.length - 1])
  let lo = 0
  let hi = e.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (e[mid] <= energy) lo = mid
    else hi = mid
  }
  const t = e[hi] === e[lo] ? 0 : (energy - e[lo]) / (e[hi] - e[lo])
  return table.columns.map((c) => c[lo] + t * (c[hi] - c[lo]))
}
