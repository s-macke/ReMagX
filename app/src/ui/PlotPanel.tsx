import { usePlotLineFit } from '../state/usePlotLineFit'
import { lineFitText } from '../model/lorentzianStep'
import { Dialog } from './Dialog'
import { plotLineSource, type PlotArea } from '../model/plotArea'
import { useMemo, useState } from 'react'
import 'uplot/dist/uPlot.min.css'
import { diagramClipboardText, diagramSeries } from '../import/asciiData'
import type { PlotProperties } from '../model/plotProperties'
import { PlotPropertiesDialog } from './PlotPropertiesDialog'
import { plotImage } from './plotImage'
import { usePlotChart } from './usePlotChart'
import { cssColor } from './plotAppearance'
import type { MeasuredCurve } from '../model/datasets'
import type { CalculatedCurve } from '../model/plotCoordinates'

interface HeldCurve {
  x: number[]
  y: number[]
  logScale: boolean
  axis: CalculatedCurve['axis']
}

interface PlotPanelProps {
  curve: CalculatedCurve | null
  measured: { label: string; curve: MeasuredCurve }[]
}

// Plot of simulated and measured curves (legacy colors: simulated red, measured green) with the
// legacy Hold / Clear / Scale buttons. Drag to zoom; the zoom is kept while values change.
export function PlotPanel({ curve, measured }: PlotPanelProps) {
  const [propertiesByView, setPropertiesByView] = useState<Record<string, PlotProperties>>({})
  const [propertiesDraft, setPropertiesDraft] = useState<PlotProperties | null>(null)
  const viewKey = `${curve?.axis}:${curve?.logScale}:${curve?.yLabel}`
  const properties = propertiesByView[viewKey]
  const logY = properties?.y.logarithmic ?? curve?.logScale ?? false
  const logX = properties?.x.logarithmic ?? false
  const [exportMessage, setExportMessage] = useState('')
  const [selectingArea, setSelectingArea] = useState(false)
  const [area, setArea] = useState<PlotArea | null>(null)
  const [areaViewKey, setAreaViewKey] = useState(viewKey)
  if (areaViewKey !== viewKey) {
    setAreaViewKey(viewKey)
    setArea(null)
  }
  const [held, setHeld] = useState<HeldCurve | null>(null)

  const lineSource = useMemo(() => plotLineSource(curve, measured, logX, logY), [curve, measured, logX, logY])
  const lineInput = useMemo(() => lineSource && area ? { source: lineSource, area } : null, [lineSource, area])
  const lineFit = usePlotLineFit(lineInput)
  const [lineResultOpen, setLineResultOpen] = useState(false)
  const fittedLine = lineFit.result
  const heldVisible = held && curve && held.axis === curve.axis && held.logScale === curve.logScale ? held : null

  const { containerRef, coordinatesRef, plotRef, legend, resetScale, readProperties, zoomOut } = usePlotChart({
    curve, measured, heldVisible, fittedLine, properties, logX, logY, selectingArea, area, setArea,
  })

  const hold = () => {
    if (curve) setHeld({ x: curve.x, y: curve.series[0].y, logScale: curve.logScale, axis: curve.axis })
  }
  const openProperties = () => {
    const draft = readProperties()
    if (draft) setPropertiesDraft(draft)
  }

  const exportPlot = async (action: 'data' | 'graphic' | 'picture') => {
    if (!curve || !plotRef.current) return
    setExportMessage('')
    try {
      if (action === 'data') {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Use File → Save diagram data.')
        const curves = diagramSeries(curve, measured)
        if (heldVisible) curves.push({ label: 'held', x: heldVisible.x, y: heldVisible.y })
        if (fittedLine) curves.push({ label: 'Lorentzian+Step fit', x: fittedLine.x, y: fittedLine.y })
        await navigator.clipboard.writeText(diagramClipboardText(curves))
        setExportMessage('Diagram data copied.')
      } else {
        if (action === 'graphic' && (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')) throw new Error('Graphic clipboard access is unavailable. Use Save Picture.')
        const mimeType = action === 'graphic' ? 'image/png' : 'image/jpeg'
        const encoded = plotImage(plotRef.current.ctx.canvas, legend ?? [], mimeType, properties?.border ?? cssColor('--panel', '#ffffff'), cssColor('--text', '#222222'), properties?.fontSize)
        if (action === 'graphic') {
          await navigator.clipboard.write([new ClipboardItem({ [mimeType]: encoded })])
          setExportMessage('Graphic copied.')
        } else {
          const url = URL.createObjectURL(await encoded)
          const link = document.createElement('a')
          link.href = url
          link.download = 'remagx-plot.jpg'
          link.click()
          setTimeout(() => URL.revokeObjectURL(url), 0)
          setExportMessage('Picture saved.')
        }
      }
    } catch (error) {
      setExportMessage(`Export failed: ${(error as Error).message}`)
    }
  }

  const copyLineFit = async () => {
    if (!fittedLine) return
    try { await navigator.clipboard.writeText(lineFitText(fittedLine)); setExportMessage('Line-fit parameters and expressions copied.') }
    catch (error) { setExportMessage(`Could not copy line fit: ${(error as Error).message}`) }
  }

  return (
    <section className="plot-panel" aria-label="Plot">
      <div className="plot-panel__canvas" ref={containerRef} aria-label={curve ? `Plot axis: ${curve.axis}` : 'No calculated curve'} />
      {legend && (
        <ul className="plot-panel__legend" style={properties ? { fontSize: properties.fontSize } : undefined}>
          {legend.map((entry) => (
            <li key={entry.label}>
              <span className="plot-panel__swatch" style={{ background: entry.color }} />
              {entry.label}
            </li>
          ))}
        </ul>
      )}
      <span className="plot-panel__coordinates" ref={coordinatesRef} aria-label="Cursor coordinates" aria-live="off">X: —  Y: —</span>
      {exportMessage && <p className="plot-panel__export-message" aria-live="polite">{exportMessage}</p>}
      {propertiesDraft && <PlotPropertiesDialog initial={propertiesDraft} onApply={value => setPropertiesByView(current => ({ ...current, [viewKey]: value }))} onClose={() => setPropertiesDraft(null)} />}
      {lineResultOpen && fittedLine && <Dialog title="Lorentzian+Step result" onClose={() => setLineResultOpen(false)}>
        <pre className="dialog__pre">{lineFitText(fittedLine)}</pre>
        <p>The fit uses the second plot series and unweighted squared residuals. Project parameters are unchanged.</p>
        <button type="button" onClick={() => void copyLineFit()}>Copy fit parameters</button>
        {exportMessage && <p role="status">{exportMessage}</p>}
      </Dialog>}
      <div className="plot-panel__analysis">
        <button type="button" disabled={!curve} aria-pressed={selectingArea} onClick={() => setSelectingArea(value => !value)}>Select Area</button>
        <button type="button" disabled={!area} onClick={() => setArea(null)}>Clear Selected Area</button>
        <button type="button" disabled={!lineInput || lineFit.busy} onClick={() => { setLineResultOpen(false); setExportMessage(''); void lineFit.start() }}>Fit Lorentzian+Step</button>
        {lineFit.busy && <button type="button" onClick={lineFit.stop}>Stop line fit</button>}
        {fittedLine && <button type="button" onClick={() => { setExportMessage(''); setLineResultOpen(true) }}>Line-fit result</button>}
        <span aria-label="Line-fit source">{lineSource ? `Fit source: ${lineSource.label}` : 'No second plot series to fit'}</span>
        <span aria-label="Selected plot area">{area ? `Selected x: ${area.min} to ${area.max}` : 'No selected area'}</span>
        {lineFit.message && <span role="status" className="plot-panel__line-fit-status">{lineFit.message}</span>}
      </div>
      <div className="plot-panel__buttons">
        <button type="button" disabled={!curve} onClick={openProperties}>Properties</button>
        <details className="plot-panel__export">
          <summary>Export</summary>
          <div>
            <button type="button" disabled={!curve} onClick={() => void exportPlot('data')}>Copy data to clipboard</button>
            <button type="button" disabled={!curve} onClick={() => void exportPlot('graphic')}>Copy graphic to clipboard</button>
            <button type="button" disabled={!curve} onClick={() => void exportPlot('picture')}>Save Picture</button>
          </div>
        </details>
        <button type="button" onClick={zoomOut} disabled={!curve} title="Double the visible range around the plot center">Zoom Out</button>
        <button type="button" onClick={hold} disabled={!curve} title="Keep the current simulation as a reference curve">
          Hold
        </button>
        <button type="button" onClick={() => setHeld(null)} disabled={!held} title="Remove the reference curve">
          Clear
        </button>
        <button type="button" onClick={resetScale} disabled={!curve} title="Fit the axes to the data again">
          Scale
        </button>
      </div>
    </section>
  )
}
