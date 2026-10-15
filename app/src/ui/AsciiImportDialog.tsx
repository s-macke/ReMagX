import { useMemo, useState } from 'react'
import {
  buildDataset,
  columnRoleLabels,
  defaultColumnRoles,
  parseAsciiTable,
  type AsciiOptions,
  type ColumnRole,
  type Separator,
} from '../import/asciiData'
import type { Dataset } from '../model/project'
import { useAppState } from '../state/context'
import { CheckboxField, Field, NumberField } from './form'

const PREVIEW_ROWS = 8

// Legacy "ASCII File Properties" dialog: how to read a measurement file and what its columns mean.
export function AsciiImportDialog({
  fileName,
  text,
  onImport,
  onCancel,
}: {
  fileName: string
  text: string
  onImport: (dataset: Dataset) => void
  onCancel: () => void
}) {
  const { project } = useAppState()
  const [options, setOptions] = useState<AsciiOptions>({ startLine: 1, separator: 'whitespace', decimalComma: false })
  const table = useMemo(() => parseAsciiTable(text, options), [text, options])
  const [roles, setRoles] = useState<ColumnRole[]>([])
  const [energy, setEnergy] = useState(project.experiment.energy)
  const [title, setTitle] = useState(fileName)
  const [error, setError] = useState<string | null>(null)

  const effectiveRoles = roles.length === table.columnCount ? roles : defaultColumnRoles(table.columnCount)
  const setRole = (column: number, role: ColumnRole) => setRoles(effectiveRoles.map((r, i) => (i === column ? role : r)))

  const importDataset = () => {
    try {
      onImport(buildDataset(table, effectiveRoles, { title, sourceFile: fileName, energy, polarization: project.experiment.polarization }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="dialog dialog--wide" role="dialog" aria-modal="true" aria-labelledby="ascii-title">
        <h2 id="ascii-title">ASCII File Properties: {fileName}</h2>
        <div className="ascii-options">
          <NumberField label="start reading at line" min={1} integer value={options.startLine} onChange={(startLine) => setOptions({ ...options, startLine })} />
          <Field label="separation sign">
            <select className="select" value={options.separator} onChange={(e) => setOptions({ ...options, separator: e.target.value as Separator })}>
              <option value="whitespace">blanks / tabulator</option>
              <option value="tab">tabulator only</option>
              <option value="comma">comma ,</option>
              <option value="semicolon">semicolon ;</option>
            </select>
          </Field>
          <CheckboxField label="decimal comma (1,5)" checked={options.decimalComma} onChange={(decimalComma) => setOptions({ ...options, decimalComma })} />
          <NumberField label="energy of the measurement" unit="eV" min={1e-9} value={energy} onChange={setEnergy} />
          <Field label="title">
            <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <p className="note">
          {table.rows.length} data rows, {table.columnCount} columns
          {table.skippedLines.length > 0 && `; skipped non-numeric lines ${table.skippedLines.slice(0, 5).join(', ')}${table.skippedLines.length > 5 ? ', …' : ''}`}
        </p>
        {table.columnCount > 0 && (
          <div className="ascii-preview">
            <table className="small-table">
              <thead>
                <tr>
                  {effectiveRoles.map((role, column) => (
                    <th key={column} scope="col">
                      <select className="select" aria-label={`meaning of column ${column + 1}`} value={role} onChange={(e) => setRole(column, e.target.value as ColumnRole)}>
                        {Object.entries(columnRoleLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                  <tr key={r}>
                    {effectiveRoles.map((_, c) => (
                      <td key={c}>{row[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="status-bar__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={importDataset} disabled={table.rows.length === 0}>
            Ok
          </button>
        </div>
      </section>
    </div>
  )
}
