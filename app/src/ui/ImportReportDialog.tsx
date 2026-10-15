import type { ImportReport } from '../import/allFile'
import { Dialog } from './Dialog'

// Shown after opening a legacy .all file: what was converted, switched or ignored (D-14).
export function ImportReportDialog({ report, fileName, onClose }: { report: ImportReport; fileName: string; onClose: () => void }) {
  const warnings = report.messages.filter((m) => m.level === 'warning')
  const notes = report.messages.filter((m) => m.level === 'info')
  return (
    <Dialog title={`Imported ${fileName}`} onClose={onClose}>
      {warnings.length > 0 ? (
        <>
          <h3>Warnings</h3>
          <ul className="report-list report-list--warning">
            {warnings.map((m, i) => (
              <li key={i}>
                {m.line ? <span className="report-list__line">line {m.line}</span> : null}
                {m.text}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>The project was imported without warnings.</p>
      )}
      {notes.length > 0 && (
        <details>
          <summary>{notes.length} notes</summary>
          <ul className="report-list">
            {notes.map((m, i) => (
              <li key={i}>{m.text}</li>
            ))}
          </ul>
        </details>
      )}
    </Dialog>
  )
}
