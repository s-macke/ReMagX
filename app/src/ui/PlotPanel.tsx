import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { diagramClipboardText, diagramSeries } from '../import/asciiData'
import { plotImage } from './plotImage'
import { zoomPlotRange } from '../model/plotZoom'
import type { MeasuredCurve } from '../model/datasets'
import type { CalculatedCurve } from '../state/useCalculation'

const SIMULATED_COLORS = ['#c0392b', '#2f6fd6']
const MEASURED_COLOR = '#2e9d4e'
const HELD_COLOR = '#8a8f98'

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

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

const isDecade = (v: number) => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9
const formatDecade = (v: number) => {
  const exponent = Math.round(Math.log10(v))
  return exponent === 0 ? '1' : `1e${exponent}`
}

// Linear tick labels with enough digits for small quantities such as δ ≈ 1e-3.
const formatLinearTicks = (_u: uPlot, splits: number[]) => {
  const step = splits.length > 1 ? Math.abs(splits[1] - splits[0]) : 1
  const largest = Math.max(...splits.map(Math.abs))
  const useExponent = largest !== 0 && (largest < 1e-2 || largest >= 1e5)
  const decimals = Math.max(0, Math.ceil(-Math.log10(step || 1)))
  return splits.map((v) => {
    if (Math.abs(v) < step * 1e-6) return '0'
    if (!useExponent) return v.toFixed(Math.min(decimals, 8))
    const digits = Math.max(0, Math.ceil(Math.log10(largest / step)) - 1)
    return v.toExponential(Math.min(digits, 6))
  })
}

// Keeps decades only, and only every n-th decade when the plot is too short for all labels.
const MIN_LABEL_SPACING_PX = 16
const decadesOnly = (u: uPlot, splits: number[]) => {
  const decades = splits.filter((v) => v > 0 && isDecade(v))
  const heightPx = u.bbox.height / (window.devicePixelRatio || 1)
  const step = Math.max(1, Math.ceil((decades.length * MIN_LABEL_SPACING_PX) / Math.max(heightPx, 1)))
  return splits.map((v) => (v > 0 && isDecade(v) && Math.round(Math.log10(v)) % step === 0 ? v : null))
}

// Log axes cannot show values <= 0; they become gaps.
const forScale = (values: number[], logScale: boolean) =>
  values.map((v) => (Number.isFinite(v) && (!logScale || v > 0) ? v : null))

// Plot of simulated and measured curves (legacy colors: simulated red, measured green) with the
// legacy Hold / Clear / Scale buttons. Drag to zoom; the zoom is kept while values change.
export function PlotPanel({ curve, measured }: PlotPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const coordinatesRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<((factor: number) => void) | null>(null)
  const [exportMessage, setExportMessage] = useState('')
  const [held, setHeld] = useState<HeldCurve | null>(null)

  const heldVisible = held && curve && held.axis === curve.axis && held.logScale === curve.logScale ? held : null

  const series = useMemo(() => {
    if (!curve) return null
    const labels = [
      ...curve.series.map((s) => s.label),
      ...measured.map((m) => m.label),
      ...(heldVisible ? ['held'] : []),
    ]
    const tables: uPlot.AlignedData[] = [
      [curve.x, ...curve.series.map((s) => forScale(s.y, curve.logScale))] as uPlot.AlignedData,
      ...measured.map((m) => [m.curve.x, forScale(m.curve.y, curve.logScale)] as uPlot.AlignedData),
      ...(heldVisible ? [[heldVisible.x, forScale(heldVisible.y, curve.logScale)] as uPlot.AlignedData] : []),
    ]
    const data = tables.length === 1 ? tables[0] : uPlot.join(tables)
    return { labels, data, signature: `${curve.axis}|${curve.logScale}|${labels.join(',')}` }
  }, [curve, measured, heldVisible])

  // (Re)create the plot when the set of series changes; otherwise only replace the data.
  const signature = series?.signature
  useEffect(() => {
    const container = containerRef.current
    if (!container || !series || !curve) return
    const text = cssColor('--text', '#222')
    const grid = cssColor('--grid', '#ddd')
    const coordinateDisplay = coordinatesRef.current
    const simulatedCount = curve.series.length
    const showCoordinates = (plot: uPlot) => {
      const { left, top } = plot.cursor
      if (!coordinatesRef.current) return
      const bounds = plot.over.getBoundingClientRect()
      if (left == null || top == null || left < 0 || top < 0 || left > bounds.width || top > bounds.height) {
        coordinatesRef.current.textContent = 'X: —  Y: —'
        return
      }
      coordinatesRef.current.textContent = `X: ${plot.posToVal(left, 'x').toPrecision(6)}  Y: ${plot.posToVal(top, 'y').toPrecision(6)}`
    }
    const options: uPlot.Options = {
      width: container.clientWidth,
      height: Math.max(120, container.clientHeight),
      scales: { x: { time: false }, y: curve.logScale ? { distr: 3, log: 10 } : { auto: true } },
      legend: { show: false },
      hooks: { setCursor: [showCoordinates], draw: [showCoordinates] },
      cursor: { drag: { x: true, y: true, uni: 20 } },
      axes: [
        { stroke: text, grid: { stroke: grid }, ticks: { stroke: grid }, label: curve.axis === 'angle' ? 'theta (°)' : curve.axis === 'qz' ? 'qz (1/Å)' : curve.axis === 'energy' ? 'energy (eV)' : 'z (Å), 0 = substrate surface' },
        curve.logScale
          ? {
              stroke: text,
              // Only decades get grid lines, ticks and labels.
              grid: { stroke: grid, filter: decadesOnly },
              ticks: { stroke: grid, filter: decadesOnly },
              size: 60,
              label: 'R',
              filter: decadesOnly,
              values: (u, splits) => decadesOnly(u, splits).map((v) => (v === null ? '' : formatDecade(v))),
            }
          : { stroke: text, grid: { stroke: grid }, ticks: { stroke: grid }, size: 70, label: curve.yLabel, values: formatLinearTicks },
      ],
      series: [
        {},
        ...series.labels.map((label, i): uPlot.Series => {
          if (i < simulatedCount) return { label, stroke: SIMULATED_COLORS[i % SIMULATED_COLORS.length], width: 1.5, spanGaps: true }
          if (label === 'held') return { label, stroke: HELD_COLOR, width: 1, dash: [6, 4], spanGaps: true }
          return { label, stroke: MEASURED_COLOR, width: 1, spanGaps: true, points: { show: false } }
        }),
      ],
    }
    const plot = new uPlot(options, series.data, container)
    plotRef.current = plot
    const zoom = (factor: number, left = plot.over.clientWidth / 2, top = plot.over.clientHeight / 2) => {
      const x = plot.scales.x
      const y = plot.scales.y
      if (x.min == null || x.max == null || y.min == null || y.max == null) return
      const nextX = zoomPlotRange({ min: x.min, max: x.max }, plot.posToVal(left, 'x'), factor)
      const nextY = zoomPlotRange({ min: y.min, max: y.max }, plot.posToVal(top, 'y'), factor, curve.logScale)
      if (nextX && nextY) plot.batch(() => { plot.setScale('x', nextX); plot.setScale('y', nextY) })
    }
    zoomRef.current = zoom
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      event.preventDefault()
      const bounds = plot.over.getBoundingClientRect()
      zoom(event.deltaY < 0 ? 0.5 : 2, event.clientX - bounds.left, event.clientY - bounds.top)
    }
    plot.over.addEventListener('wheel', wheel, { passive: false })
    const observer = new ResizeObserver(() => plot.setSize({ width: container.clientWidth, height: Math.max(120, container.clientHeight) }))
    observer.observe(container)
    return () => {
      observer.disconnect()
      plot.over.removeEventListener('wheel', wheel)
      zoomRef.current = null
      if (coordinateDisplay) coordinateDisplay.textContent = 'X: —  Y: —'
      plot.destroy()
      plotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreated only when the series layout changes
  }, [signature])

  useEffect(() => {
    if (series) plotRef.current?.setData(series.data, false)
  }, [series])

  const hold = () => {
    if (curve) setHeld({ x: curve.x, y: curve.series[0].y, logScale: curve.logScale, axis: curve.axis })
  }
  const resetScale = () => {
    const plot = plotRef.current
    if (!series || !plot) return
    plot.batch(() => {
      plot.setData(series.data, true)
      const xs = series.data[0]
      if (xs.length > 1 && xs[0] < xs[xs.length - 1]) plot.setScale('x', { min: xs[0], max: xs[xs.length - 1] })
    })
  }

  const legend = series?.labels.map((label, i) => ({
    label,
    color:
      curve && i < curve.series.length
        ? SIMULATED_COLORS[i % SIMULATED_COLORS.length]
        : label === 'held'
          ? HELD_COLOR
          : MEASURED_COLOR,
  }))

  const exportPlot = async (action: 'data' | 'graphic' | 'picture') => {
    if (!curve || !plotRef.current) return
    setExportMessage('')
    try {
      if (action === 'data') {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Use File → Save diagram data.')
        const curves = diagramSeries(curve, measured)
        if (heldVisible) curves.push({ label: 'held', x: heldVisible.x, y: heldVisible.y })
        await navigator.clipboard.writeText(diagramClipboardText(curves))
        setExportMessage('Diagram data copied.')
      } else {
        if (action === 'graphic' && (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')) throw new Error('Graphic clipboard access is unavailable. Use Save Picture.')
        const mimeType = action === 'graphic' ? 'image/png' : 'image/jpeg'
        const encoded = plotImage(plotRef.current.ctx.canvas, legend ?? [], mimeType, cssColor('--panel', '#ffffff'), cssColor('--text', '#222222'))
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

  return (
    <section className="plot-panel" aria-label="Plot">
      <div className="plot-panel__canvas" ref={containerRef} aria-label={curve ? `Plot axis: ${curve.axis}` : 'No calculated curve'} />
      {legend && (
        <ul className="plot-panel__legend">
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
      <div className="plot-panel__buttons">
        <details className="plot-panel__export">
          <summary>Export</summary>
          <div>
            <button type="button" disabled={!curve} onClick={() => void exportPlot('data')}>Copy data to clipboard</button>
            <button type="button" disabled={!curve} onClick={() => void exportPlot('graphic')}>Copy graphic to clipboard</button>
            <button type="button" disabled={!curve} onClick={() => void exportPlot('picture')}>Save Picture</button>
          </div>
        </details>
        <button type="button" onClick={() => zoomRef.current?.(2)} disabled={!curve} title="Double the visible range around the plot center">Zoom Out</button>
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
