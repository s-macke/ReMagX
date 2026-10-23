import data from '../data/chantler.json'
import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import { legacyAtomicMasses } from './legacyAtomicMasses'

// ReadElement: local nonempty .ff data wins, even outside its energy range.
// Fallback requires the saved flag and an active element film. Retain accompanying
// .ffm/.F tables. FindElement is exact-case and first-match, including legacy Ti/Tl.
export function resolveChantlerTables(project: Project, supplied: OpticalTable[]): OpticalTable[] {
  if (!project.calculation.useChantlerDatabase || project.sample.mode !== 'element') return supplied
  const tables = supplied.slice()
  for (const profile of project.sample.elementProfiles) {
    const position = tables.findIndex(table => table.kind === 'ff' && table.name === profile.element)
    if (position >= 0 && tables[position].energy.length) continue
    const elementIndex = legacyAtomicMasses.findIndex(([name]) => name === profile.element)
    if (elementIndex < 0 || elementIndex >= data.elements.length) continue
    const rows = data.elements[elementIndex].rows
    const table: OpticalTable = { name: profile.element, kind: 'ff', energy: rows.map(row => row[0]),
      columns: [rows.map(row => row[1]), rows.map(row => row[2])], warnings: [] }
    if (position < 0) tables.push(table)
    else tables[position] = table
  }
  return tables
}
