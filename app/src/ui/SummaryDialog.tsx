import { useRef, useState } from 'react'
import type { OpticalTable } from '../import/tables'
import type { Project } from '../model/project'
import { summaryText } from '../model/summary'
import { useSummaryCalculation } from '../state/useSummaryCalculation'
import { SummaryChart } from './SummaryChart'
import { Dialog } from './Dialog'
import { summaryImage } from './summaryImage'

export function SummaryDialog({ project, tables, onClose }: { project: Project; tables: OpticalTable[]; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const { rows, busy, stop } = useSummaryCalculation(project, tables, setMessage)
  const [dimensions, setDimensions] = useState({ width: 200, height: 200 })
  const [draft, setDraft] = useState(dimensions)
  const [sharedX, setSharedX] = useState(false), [sharedY, setSharedY] = useState(false), [showError, setShowError] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  const copyData = async () => {
    try { await navigator.clipboard.writeText(summaryText(rows ?? [])); setMessage('All data copied.') }
    catch { setMessage('Could not copy data. Allow clipboard access in your browser.') }
  }
  const copyGraphic = async () => {
    try {
      if (!grid.current || !rows?.length) return
      setMessage('Preparing chart images…')
      const blob = await summaryImage(grid.current, rows, dimensions.width, showError)
      setMessage('Copying all graphics…')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setMessage('All graphics copied.')
    } catch (error) { setMessage(`Could not copy graphics. Check clipboard permission. ${error instanceof Error ? error.message : String(error)}`) }
  }
  return <Dialog title="Summary" onClose={onClose}>
    <div style={{ width: 'min(1000px, 80vw)' }}>
      <p>All datasets — snapshot when opened. Update changes the layout only.</p>
      <div className="summary-controls">
        <label>Chart width <input aria-label="Chart width" type="number" min={200} max={1000} value={draft.width} onChange={event => setDraft({ ...draft, width: Number(event.target.value) })} /></label>
        <label>Chart height <input aria-label="Chart height" type="number" min={200} max={1000} value={draft.height} onChange={event => setDraft({ ...draft, height: Number(event.target.value) })} /></label>
        <button onClick={() => {
          if (Object.values(draft).every(value => Number.isFinite(value) && value >= 200 && value <= 1000)) { setDimensions(draft); setMessage('Layout updated.') }
          else setMessage('Chart sizes must be between 200 and 1000 pixels.')
        }}>Update</button>
        <label><input type="checkbox" checked={sharedX} onChange={event => setSharedX(event.target.checked)} />Scale x-axis</label>
        <label><input type="checkbox" checked={sharedY} onChange={event => setSharedY(event.target.checked)} />Scale y-axis (qz)</label>
        <label><input type="checkbox" checked={showError} onChange={event => setShowError(event.target.checked)} />Show Error</label>
        <button disabled={!rows?.length} onClick={() => void copyData()}>Copy All Data</button>
        <button disabled={!rows?.length} onClick={() => void copyGraphic()}>Copy All Graphic</button>
        {busy && <button onClick={stop}>Stop Summary</button>}
      </div>
      <p role="status">{busy ? 'Calculating all datasets…' : message || (rows?.length ? `${rows.length} datasets` : 'No datasets in this project.')}</p>
      <div ref={grid} className="summary-grid">
        {rows?.map(row => <SummaryChart key={row.datasetIndex} row={row} rows={rows} {...dimensions} sharedX={sharedX} sharedY={sharedY} showError={showError} />)}
      </div>
    </div>
  </Dialog>
}
