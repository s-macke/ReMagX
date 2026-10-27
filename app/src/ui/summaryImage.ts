import { summarySeries, type SummaryDataset } from '../model/summary'
import { plotImage } from './plotImage'

// Encodes the complete grid, including charts below the visible scroll area.
// Clipboard permissions and user-facing messages belong to the dialog.
export async function summaryImage(grid: HTMLElement, rows: SummaryDataset[], chartWidth: number, showError: boolean): Promise<Blob> {
  const charts = Array.from(grid.querySelectorAll<HTMLElement>('.summary-chart'))
  const images = await Promise.all(charts.map(async (chart, index) => {
    const canvas = chart.querySelector('canvas')
    if (!canvas) throw new Error('A chart is not ready.')
    const legend = [{ label: rows[index].title, color: '#111111' }, ...summarySeries(rows[index])]
    if (showError) legend.push({ label: `Weighted error: ${rows[index].weightedError}`, color: '#111111' })
    return createImageBitmap(await plotImage(canvas, legend, 'image/png', '#ffffff', '#111111'))
  }))
  try {
    const columns = Math.max(1, Math.floor(grid.clientWidth / (chartWidth + 12)))
    const width = Math.max(...images.map(image => image.width)), height = Math.max(...images.map(image => image.height))
    const output = document.createElement('canvas')
    output.width = width * Math.min(columns, images.length); output.height = height * Math.ceil(images.length / columns)
    const context = output.getContext('2d')
    if (!context) throw new Error('Image export is unavailable.')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height)
    images.forEach((image, index) => context.drawImage(image, index % columns * width, Math.floor(index / columns) * height))
    const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode all charts.')), 'image/png'))
    return blob
  } finally { images.forEach(image => image.close()) }
}
