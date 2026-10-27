import { useEffect, useMemo, useRef } from 'react'
import uPlot from 'uplot'
import { selectedPlotArea, type PlotArea } from '../model/plotArea'
import { logarithmicPlotTicks, plotTicks, type PlotProperties } from '../model/plotProperties'
import { zoomPlotRange } from '../model/plotZoom'
import type { MeasuredCurve } from '../model/datasets'
import type { CalculatedCurve } from '../model/plotCoordinates'
import { SIMULATED_COLORS, MEASURED_COLOR, HELD_COLOR, cssColor, formatDecade, formatLinearTicks, decadesOnly } from './plotAppearance'

interface PlotChartOptions {
  curve: CalculatedCurve | null
  measured: { label: string; curve: MeasuredCurve }[]
  heldVisible: { x: number[]; y: number[] } | null
  fittedLine: { x: number[]; y: number[] } | null
  properties: PlotProperties | undefined
  logX: boolean
  logY: boolean
  selectingArea: boolean
  area: PlotArea | null
  setArea: (area: PlotArea | null) => void
}

// Log axes cannot show values <= 0; they become gaps.
const forScale = (values: number[], logScale: boolean) =>
  values.map((v) => (Number.isFinite(v) && (!logScale || v > 0) ? v : null))

// Owns the uPlot instance, DOM listeners and resize observer. Data updates preserve zoom.
export function usePlotChart({ curve, measured, heldVisible, fittedLine, properties, logX, logY, selectingArea, area, setArea }: PlotChartOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const boundaryMarksRef = useRef(curve?.boundaryMarks)
  boundaryMarksRef.current = curve?.boundaryMarks
  const plotRef = useRef<uPlot | null>(null)
  const coordinatesRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<((factor: number) => void) | null>(null)
  const selectingAreaRef = useRef(selectingArea)
  selectingAreaRef.current = selectingArea
  const areaRef = useRef(area)
  areaRef.current = area
  const series = useMemo(() => {
    if (!curve) return null
    const labels = [
      ...curve.series.map((s) => s.label),
      ...measured.map((m) => m.label),
      ...(heldVisible ? ['held'] : []),
      ...(fittedLine ? ['Lorentzian+Step fit'] : []),
    ]
    const tables: uPlot.AlignedData[] = [
      [curve.x, ...curve.series.map((s) => forScale(s.y, logY))] as uPlot.AlignedData,
      ...measured.map((m) => [m.curve.x, forScale(m.curve.y, logY)] as uPlot.AlignedData),
      ...(heldVisible ? [[heldVisible.x, forScale(heldVisible.y, logY)] as uPlot.AlignedData] : []),
      ...(fittedLine ? [[fittedLine.x, forScale(fittedLine.y, logY)] as uPlot.AlignedData] : []),
    ]
    let data = tables.length === 1 ? tables[0] : uPlot.join(tables)
    if (logX) {
      const indices = Array.from(data[0]).flatMap((value, i) => value > 0 ? [i] : [])
      data = data.map(column => indices.map(i => column[i])) as uPlot.AlignedData
    }
    return { labels, data, signature: `${curve.axis}|${curve.logScale}|${labels.join(',')}` }
  }, [curve, measured, heldVisible, fittedLine, logY, logX])

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
        const region = areaRef.current
        if (region) {
          const left = Math.max(bbox.left, plot.valToPos(logX ? Math.max(region.min, plot.scales.x.min ?? region.min) : region.min, 'x', true))
          const right = Math.min(bbox.left + bbox.width, plot.valToPos(region.max, 'x', true))
          if (Number.isFinite(left) && Number.isFinite(right) && left < right) {
            ctx.beginPath(); ctx.rect(left, bbox.top, right - left, bbox.height); ctx.clip()
            ctx.fillStyle = 'rgba(60, 130, 220, 0.12)'; ctx.fillRect(left, bbox.top, right - left, bbox.height)
            ctx.strokeStyle = 'rgba(60, 130, 220, 0.4)'; ctx.lineWidth = devicePixelRatio
            for (let x = left - bbox.height; x < right; x += 12 * devicePixelRatio) {
              ctx.beginPath(); ctx.moveTo(x, bbox.top + bbox.height); ctx.lineTo(x + bbox.height, bbox.top); ctx.stroke()
            }
          }
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
          if (label === 'Lorentzian+Step fit') return { label, stroke: '#9854b3', width: 2, dash: [4, 3], spanGaps: true }
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
    let areaStart: number | null = null
    const pointerValue = (event: MouseEvent) => plot.posToVal(event.clientX - plot.over.getBoundingClientRect().left, 'x')
    const beginArea = (event: MouseEvent) => {
      if (!selectingAreaRef.current || event.button !== 0) return
      event.preventDefault(); event.stopImmediatePropagation()
      areaStart = pointerValue(event)
      setArea(null)
    }
    const dragArea = (event: MouseEvent) => {
      if (areaStart === null) return
      setArea(selectedPlotArea(areaStart, pointerValue(event)))
    }
    const finishArea = (event: MouseEvent) => {
      if (areaStart === null) return
      dragArea(event); areaStart = null
    }
    plot.over.addEventListener('mousedown', beginArea, true)
    document.addEventListener('mousemove', dragArea)
    document.addEventListener('mouseup', finishArea)
    const observer = new ResizeObserver(() => plot.setSize({ width: container.clientWidth, height: Math.max(120, container.clientHeight) }))
    observer.observe(container)
    return () => {
      observer.disconnect()
      plot.over.removeEventListener('wheel', wheel)
      plot.over.removeEventListener('mousedown', beginArea, true)
      document.removeEventListener('mousemove', dragArea)
      document.removeEventListener('mouseup', finishArea)
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

  useEffect(() => { plotRef.current?.redraw() }, [area])

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
        : label === 'Lorentzian+Step fit' ? '#9854b3' : label === 'held'
          ? HELD_COLOR
          : MEASURED_COLOR),
  }))

  const readProperties = (): PlotProperties | undefined => {
    const plot = plotRef.current
    if (!plot) return
    const x = plot.scales.x
    const y = plot.scales.y
    if (x.min == null || x.max == null || y.min == null || y.max == null) return
    return {
      x: { min: x.min, max: x.max, steps: properties?.x.steps ?? 5, logarithmic: logX },
      y: { min: y.min, max: y.max, steps: properties?.y.steps ?? 5, logarithmic: logY },
      background: properties?.background ?? cssColor('--panel', '#ffffff'),
      border: properties?.border ?? cssColor('--panel', '#ffffff'),
      colors: properties?.colors ?? Array.from({ length: 8 }, (_, i) => legend?.[i]?.color ?? SIMULATED_COLORS[i % SIMULATED_COLORS.length]),
      fontSize: properties?.fontSize ?? 12, lineWidth: properties?.lineWidth ?? 1.5, points: properties?.points ?? false,
    }
  }

  return { containerRef, coordinatesRef, plotRef, legend, resetScale, readProperties, zoomOut: () => zoomRef.current?.(2) }
}
