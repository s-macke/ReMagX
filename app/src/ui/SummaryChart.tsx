import { useEffect, useMemo, useRef } from 'react'
import uPlot from 'uplot'
import { summaryRange, summarySeries, type SummaryDataset } from '../model/summary'
import { logarithmicPlotTicks } from '../model/plotProperties'

export function SummaryChart({ row, rows, width, height, sharedX, sharedY, showError }: {
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

