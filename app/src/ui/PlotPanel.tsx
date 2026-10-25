import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { diagramClipboardText, diagramSeries } from '../import/asciiData'
import { logarithmicPlotTicks, plotTicks, type PlotProperties } from '../model/plotProperties'
import { PlotPropertiesDialog } from './PlotPropertiesDialog'
import { plotImage } from './plotImage'
import { zoomPlotRange } from '../model/plotZoom'
import type { MeasuredCurve } from '../model/datasets'
import type { CalculatedCurve } from '../state/useCalculation'

const SIMULATED_COLORS = ['#c0392b', '#2f6fd6', '#218c54', '#9854b3', '#bb7900', '#008b95', '#d04d86', '#69757d']
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
  const boundaryMarksRef = useRef(curve?.boundaryMarks)
  boundaryMarksRef.current = curve?.boundaryMarks
  const plotRef = useRef<uPlot | null>(null)
  const coordinatesRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<((factor: number) => void) | null>(null)
  const [propertiesByView, setPropertiesByView] = useState<Record<string, PlotProperties>>({})
  const [propertiesDraft, setPropertiesDraft] = useState<PlotProperties | null>(null)
  const viewKey = `${curve?.axis}:${curve?.logScale}:${curve?.yLabel}`
  const properties = propertiesByView[viewKey]
  const logY = properties?.y.logarithmic ?? curve?.logScale ?? false
  const logX = properties?.x.logarithmic ?? false
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
      [curve.x, ...curve.series.map((s) => forScale(s.y, logY))] as uPlot.AlignedData,
      ...measured.map((m) => [m.curve.x, forScale(m.curve.y, logY)] as uPlot.AlignedData),
      ...(heldVisible ? [[heldVisible.x, forScale(heldVisible.y, logY)] as uPlot.AlignedData] : []),
    ]
    let data = tables.length === 1 ? tables[0] : uPlot.join(tables)
    if (logX) {
      const indices = Array.from(data[0]).flatMap((value, i) => value > 0 ? [i] : [])
      data = data.map(column => indices.map(i => column[i])) as uPlot.AlignedData
    }
    return { labels, data, signature: `${curve.axis}|${curve.logScale}|${labels.join(',')}` }
  }, [curve, measured, heldVisible, logY, logX])

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
      scales: { x: { time: false, distr: logX ? 3 : 1 }, y: logY ? { distr: 3, log: 10 } : { auto: true } },
      legend: { show: false },
      hooks: { setCursor: [showCoordinates], draw: [showCoordinates, plot => {
        const { ctx, bbox } = plot
        ctx.save()
        ctx.beginPath()
        ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height)
        ctx.clip()
        for (const mark of boundaryMarksRef.current ?? []) {
          if (plot.series[mark.seriesIndex + 1]?.show === false || (logX && mark.x <= 0) || (logY && mark.y - 0.002 <= 0)) continue
          ctx.strokeStyle = properties?.colors[mark.seriesIndex % properties.colors.length] ?? SIMULATED_COLORS[mark.seriesIndex % SIMULATED_COLORS.length]
          ctx.lineWidth = devicePixelRatio
          const x = plot.valToPos(mark.x, 'x', true)
          ctx.beginPath()
          ctx.moveTo(x, plot.valToPos(mark.y - 0.002, 'y', true))
          ctx.lineTo(x, plot.valToPos(mark.y + 0.002, 'y', true))
          ctx.stroke()
        }
        ctx.restore()
      }] },
      cursor: { drag: { x: true, y: true, uni: 20 } },
      axes: [
        { splits: logX ? (_plot, _index, min, max) => logarithmicPlotTicks(min, max) : undefined, stroke: text, grid: { stroke: grid }, ticks: { stroke: grid }, label: curve.axis === 'angle' ? 'theta (°)' : curve.axis === 'qz' ? 'qz (1/Å)' : curve.axis === 'energy' ? 'energy (eV)' : 'z (Å), 0 = substrate surface' },
        logY
          ? {
              stroke: text,
              // Only decades get grid lines, ticks and labels.
              splits: (_plot, _index, min, max) => logarithmicPlotTicks(min, max),
              grid: { stroke: grid, filter: decadesOnly },
              ticks: { stroke: grid, filter: decadesOnly },
              size: 60,
              label: curve.yLabel,
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
    if (properties) {
      options.scales!.x.range = (_plot, min, max) => [min, max]
      options.scales!.y.range = (_plot, min, max) => [min, max]
      options.axes!.forEach((axis, index) => {
        const settings = index === 0 ? properties.x : properties.y
        axis.font = `${properties.fontSize}px sans-serif`
        axis.labelFont = `${properties.fontSize}px sans-serif`
        axis.size = index === 0 ? Math.max(50, properties.fontSize * 3) : Math.max(70, properties.fontSize * 5)
        axis.splits = (_plot, _index, min, max) => plotTicks(min, max, settings.steps, settings.logarithmic)
        axis.filter = (_plot, splits) => splits
        axis.grid = { stroke: grid }
        axis.ticks = { stroke: grid }
        axis.values = (_plot, splits) => splits.map(value => Number(value.toPrecision(5)).toString())
      })
      options.series!.slice(1).forEach((entry, index) => {
        entry.stroke = properties.colors[index % properties.colors.length]
        entry.width = properties.lineWidth
        entry.points = { show: properties.points }
      })
      options.hooks!.drawClear = [plot => {
        const { ctx, bbox } = plot
        ctx.save()
        ctx.fillStyle = properties.border
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
        ctx.fillStyle = properties.background
        ctx.fillRect(bbox.left, bbox.top, bbox.width, bbox.height)
        ctx.restore()
      }]
    }
    const plot = new uPlot(options, series.data, container)
    if (properties) plot.batch(() => { plot.setScale('x', properties.x); plot.setScale('y', properties.y) })
    plotRef.current = plot
    const zoom = (factor: number, left = plot.over.clientWidth / 2, top = plot.over.clientHeight / 2) => {
      const x = plot.scales.x
      const y = plot.scales.y
      if (x.min == null || x.max == null || y.min == null || y.max == null) return
      const nextX = zoomPlotRange({ min: x.min, max: x.max }, plot.posToVal(left, 'x'), factor, logX)
      const nextY = zoomPlotRange({ min: y.min, max: y.max }, plot.posToVal(top, 'y'), factor, logY)
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
  }, [signature, properties])

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
      const lower = logX ? xs.find(value => value > 0) : xs[0]
      if (lower !== undefined && xs.length > 1 && lower < xs[xs.length - 1]) plot.setScale('x', { min: lower, max: xs[xs.length - 1] })
    })
  }

  const legend = series?.labels.map((label, i) => ({
    label,
    color: properties?.colors[i % properties.colors.length] ?? (
      curve && i < curve.series.length
        ? SIMULATED_COLORS[i % SIMULATED_COLORS.length]
        : label === 'held'
          ? HELD_COLOR
          : MEASURED_COLOR),
  }))

  const openProperties = () => {
    const plot = plotRef.current
    if (!plot) return
    const x = plot.scales.x
    const y = plot.scales.y
    if (x.min == null || x.max == null || y.min == null || y.max == null) return
    setPropertiesDraft({
      x: { min: x.min, max: x.max, steps: properties?.x.steps ?? 5, logarithmic: logX },
      y: { min: y.min, max: y.max, steps: properties?.y.steps ?? 5, logarithmic: logY },
      background: properties?.background ?? cssColor('--panel', '#ffffff'),
      border: properties?.border ?? cssColor('--panel', '#ffffff'),
      colors: properties?.colors ?? Array.from({ length: 8 }, (_, i) => legend?.[i]?.color ?? SIMULATED_COLORS[i % SIMULATED_COLORS.length]),
      fontSize: properties?.fontSize ?? 12, lineWidth: properties?.lineWidth ?? 1.5, points: properties?.points ?? false,
    })
  }

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
