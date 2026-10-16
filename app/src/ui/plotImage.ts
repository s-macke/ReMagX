// Export the rendered plot (axes and current zoom) with an opaque background and legend.
// Clipboard images use PNG; Save Picture keeps the legacy JPEG format.
export function plotImage(canvas: HTMLCanvasElement, legend: { label: string; color: string }[], mimeType: 'image/png' | 'image/jpeg', background: string, text: string, fontSize = 12): Promise<Blob> {
  const scale = window.devicePixelRatio || 1
  const rowHeight = (fontSize + 8) * scale
  const output = document.createElement('canvas')
  output.width = canvas.width
  output.height = canvas.height + Math.ceil(rowHeight * legend.length)
  const context = output.getContext('2d')
  if (!context) return Promise.reject(new Error('Image export is unavailable in this browser.'))
  context.fillStyle = background
  context.fillRect(0, 0, output.width, output.height)
  context.drawImage(canvas, 0, 0)
  context.font = `${fontSize * scale}px sans-serif`
  context.textBaseline = 'middle'
  legend.forEach((entry, index) => {
    const y = canvas.height + rowHeight * (index + 0.5)
    context.strokeStyle = entry.color
    context.lineWidth = 2 * scale
    context.beginPath()
    context.moveTo(12 * scale, y)
    context.lineTo(32 * scale, y)
    context.stroke()
    context.fillStyle = text
    context.fillText(entry.label, 40 * scale, y)
  })
  return new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the plot image.')), mimeType, 0.95))
}
