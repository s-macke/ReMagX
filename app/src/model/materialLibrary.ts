import { z } from 'zod'
import { tableKinds, type OpticalTable } from '../import/tables'

const opticalTableSchema = z.object({
  name: z.string(),
  kind: z.enum(['db', 'm', 'e', 'ff', 'ffm']),
  energy: z.array(z.number().finite()),
  columns: z.array(z.array(z.number().finite())),
  warnings: z.array(z.string()),
}).refine(table => table.columns.length === tableKinds[table.kind].columns.length &&
  table.columns.every(column => column.length === table.energy.length) &&
  table.energy.every((energy, index) => index === 0 || energy >= table.energy[index - 1]),
{ message: 'Invalid table dimensions or energy order.' })

export function readStoredOpticalTable(value: unknown): OpticalTable | null {
  const result = z.object({ version: z.literal(1), table: opticalTableSchema }).safeParse(value)
  return result.success ? result.data.table : null
}

export const opticalTableKey = (table: Pick<OpticalTable, 'name' | 'kind'>): string => JSON.stringify([table.name, table.kind])

// New imports win by material name and table kind; other kinds/materials are retained.
export function mergeOpticalTables(stored: OpticalTable[], imported: OpticalTable[]): OpticalTable[] {
  const tables = new Map(stored.map(table => [opticalTableKey(table), table]))
  for (const table of imported) tables.set(opticalTableKey(table), table)
  return [...tables.values()]
}
