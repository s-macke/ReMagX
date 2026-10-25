import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import { WorkerComputeService, ComputeCancelled } from '../compute'
import type { OpticalTable } from '../import/tables'
import type { Project } from '../model/project'
import { summaryRange, summarySeries, summaryText, type SummaryDataset } from '../model/summary'
import { logarithmicPlotTicks } from '../model/plotProperties'
import { Dialog } from './Dialog'
import { plotImage } from './plotImage'

function SummaryChart({ row, rows, width, height, sharedX, sharedY, showError }: {
  row: SummaryDataset; rows: SummaryDataset[]; width: number; height: number; sharedX: boolean; sharedY: boolean; showError: boolean
}) {
  const target = useRef<HTMLDivElement>(null)
  const series = useMemo(() => summarySeries(row), [row])
  useEffect(() => {
    if (!target.current) return
    const logarithmic = row.mode !== 'asymmetry'
    const data = uPlot.join(series.map(series => {
      const order = series.x.map((x, i) => ({ x, y: series.y[i] })).sort((a, b) => a.x - b.x)
      return [order.map(point => point.x), order.map(point => Number.isFinite(point.y) && (!logarithmic || point.y > 0) ? point.y : null)] as uPlot.AlignedData
    }))
    const x = sharedX ? summaryRange(rows, 'x', row.scan) : undefined
    const y = sharedY && row.scan === 'qz' ? summaryRange(rows, 'y', 'qz', logarithmic) : undefined
    const plot = new uPlot({ width, height, legend: { show: false }, cursor: { show: false }, select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      scales: { x: { time: false, ...(x ? { range: () => x } : {}) }, y: { distr: logarithmic ? 3 : 1, ...(y ? { range: () => y } : {}) } },
      axes: [{ label: row.scan === 'energy' ? 'Energy (eV)' : 'qz (Å⁻¹)', size: 35, labelSize: 20 }, { size: 55, splits: logarithmic ? (_plot, _index, min, max) => logarithmicPlotTicks(min, max) : undefined }],
      series: [{}, ...series.map(series => ({ label: series.label, stroke: series.color, width: 1, points: { show: false } }))],
    }, data, target.current)
    return () => plot.destroy()
  }, [row, rows, series, width, height, sharedX, sharedY])
  return <section className="summary-chart" style={{ width }} aria-label={row.title}>
    <strong>{row.title}</strong>
    <div ref={target} />
    <div className="summary-legend">{series.map(series => <span key={series.label} style={{ color: series.color }}>{series.label} </span>)}</div>
    {showError && <div className="summary-error">Weighted error: {row.weightedError}</div>}
  </section>
}

export function SummaryDialog({ project, tables, onClose }: { project: Project; tables: OpticalTable[]; onClose: () => void }) {
  // The original builds a snapshot when opened. Layout changes never recalculate it.
  const [snapshot] = useState(() => ({ project: structuredClone(project), tables: structuredClone(tables) }))
  const [rows, setRows] = useState<SummaryDataset[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [dimensions, setDimensions] = useState({ width: 200, height: 200 })
  const [draft, setDraft] = useState(dimensions)
  const [sharedX, setSharedX] = useState(false), [sharedY, setSharedY] = useState(false), [showError, setShowError] = useState(false)
  const service = useRef<WorkerComputeService | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const worker = new WorkerComputeService()
    service.current = worker
    let current = true
    worker.summary(snapshot.project, undefined, snapshot.tables).then(result => {
      if (current) setRows(result)
    }).catch(error => { if (current) setMessage(error instanceof ComputeCancelled ? 'Stopped. Close and reopen Summary to calculate again.' : String(error.message ?? error)) })
      .finally(() => { if (current) setBusy(false) })
    return () => { current = false; service.current = null; worker.dispose() }
  }, [snapshot])
  const copyData = async () => {
    try { await navigator.clipboard.writeText(summaryText(rows ?? [])); setMessage('All data copied.') }
    catch { setMessage('Could not copy data. Allow clipboard access in your browser.') }
  }
  const copyGraphic = async () => {
    try {
      if (!grid.current || !rows?.length) return
      setMessage('Preparing chart images…')
      const charts = Array.from(grid.current.querySelectorAll<HTMLElement>('.summary-chart'))
      const images = await Promise.all(charts.map(async (chart, index) => {
        const canvas = chart.querySelector('canvas')
        if (!canvas) throw new Error('A chart is not ready.')
        const legend = [{ label: rows[index].title, color: '#111111' }, ...summarySeries(rows[index])]
        if (showError) legend.push({ label: `Weighted error: ${rows[index].weightedError}`, color: '#111111' })
        return createImageBitmap(await plotImage(canvas, legend, 'image/png', '#ffffff', '#111111'))
      }))
      try {
        const columns = Math.max(1, Math.floor(grid.current.clientWidth / (dimensions.width + 12)))
        const width = Math.max(...images.map(image => image.width)), height = Math.max(...images.map(image => image.height))
        const output = document.createElement('canvas')
        output.width = width * Math.min(columns, images.length); output.height = height * Math.ceil(images.length / columns)
        const context = output.getContext('2d')
        if (!context) throw new Error('Image export is unavailable.')
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height)
        images.forEach((image, index) => context.drawImage(image, index % columns * width, Math.floor(index / columns) * height))
        const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode all charts.')), 'image/png'))
        setMessage('Copying all graphics…')
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setMessage('All graphics copied.')
      } finally { images.forEach(image => image.close()) }
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
        {busy && <button onClick={() => service.current?.stop()}>Stop Summary</button>}
      </div>
      <p role="status">{busy ? 'Calculating all datasets…' : message || (rows?.length ? `${rows.length} datasets` : 'No datasets in this project.')}</p>
      <div ref={grid} className="summary-grid">
        {rows?.map(row => <SummaryChart key={row.datasetIndex} row={row} rows={rows} {...dimensions} sharedX={sharedX} sharedY={sharedY} showError={showError} />)}
      </div>
    </div>
  </Dialog>
}
