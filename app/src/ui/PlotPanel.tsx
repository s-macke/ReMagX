import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
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

const decadesOnly = (_u: uPlot, splits: number[]) => splits.map((v) => (v > 0 && isDecade(v) ? v : null))

// Log axes cannot show values <= 0; they become gaps.
const forScale = (values: number[], logScale: boolean) =>
  values.map((v) => (Number.isFinite(v) && (!logScale || v > 0) ? v : null))

// Plot of simulated and measured curves (legacy colors: simulated red, measured green) with the
// legacy Hold / Clear / Scale buttons. Drag to zoom; the zoom is kept while values change.
export function PlotPanel({ curve, measured }: PlotPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
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
    const simulatedCount = curve.series.length
    const options: uPlot.Options = {
      width: container.clientWidth,
      height: Math.max(120, container.clientHeight),
      scales: { x: { time: false }, y: curve.logScale ? { distr: 3, log: 10 } : { auto: true } },
      legend: { show: false },
      cursor: { drag: { x: true, y: true, uni: 20 } },
      axes: [
        { stroke: text, grid: { stroke: grid }, ticks: { stroke: grid }, label: curve.axis === 'qz' ? 'qz (1/Å)' : curve.axis === 'energy' ? 'energy (eV)' : 'z (Å), 0 = substrate surface' },
        curve.logScale
          ? {
              stroke: text,
              // Only decades get grid lines, ticks and labels.
              grid: { stroke: grid, filter: decadesOnly },
              ticks: { stroke: grid, filter: decadesOnly },
              size: 60,
              label: 'R',
              filter: decadesOnly,
              values: (_u, splits) => splits.map((v) => (v > 0 && isDecade(v) ? formatDecade(v) : '')),
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
    const observer = new ResizeObserver(() => plot.setSize({ width: container.clientWidth, height: Math.max(120, container.clientHeight) }))
    observer.observe(container)
    return () => {
      observer.disconnect()
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
    if (series) plotRef.current?.setData(series.data, true)
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

  return (
    <section className="plot-panel" aria-label="Plot">
      <div className="plot-panel__canvas" ref={containerRef} />
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
      <div className="plot-panel__buttons">
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
