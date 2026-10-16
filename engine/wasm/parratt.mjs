// Prepared-stack adapter; higher-level project preparation belongs in the worker.
export function calculateParratt(module, { layers, points, beam, tensor = 0, analyzer = 0 }) {
  const rowsValid = (rows, width) => Array.isArray(rows) && rows.length > 0 &&
    rows.every(row => Array.isArray(row) && row.length === width && row.every(Number.isFinite))
  if (!rowsValid(layers, 8) || layers.length < 2 || !rowsValid(points, 3) ||
      !Array.isArray(beam) || beam.length !== 4 || !beam.every(Number.isFinite) ||
      ![0, 1].includes(tensor) || ![0, 1, 2].includes(analyzer)) {
    throw new TypeError('Invalid prepared Parratt input')
  }
  const allocations = []
  const allocate = count => {
    const bytes = count * 8
    if (!Number.isSafeInteger(bytes) || bytes > 0x7fffffff) throw new RangeError('Parratt buffer too large')
    const pointer = module._malloc(bytes)
    if (!pointer) throw new Error('Parratt allocation failed')
    allocations.push(pointer)
    return pointer
  }
  try {
    const layerPointer = allocate(layers.length * 8)
    const pointPointer = allocate(points.length * 3)
    const beamPointer = allocate(4)
    const outputPointer = allocate(points.length)
    // Allocations and the core call can grow memory: never retain heap views across them.
    module.HEAPF64.set(layers.flat(), layerPointer / 8)
    module.HEAPF64.set(points.flat(), pointPointer / 8)
    module.HEAPF64.set(beam, beamPointer / 8)
    const status = module._remagx_parratt(layerPointer, layers.length, pointPointer,
      points.length, beamPointer, tensor, analyzer, outputPointer)
    if (status !== 0) {
      const error = new Error(`Parratt calculation failed (status ${status})`)
      error.status = status
      throw error
    }
    return module.HEAPF64.slice(outputPointer / 8, outputPointer / 8 + points.length)
  } finally {
    for (const pointer of allocations) module._free(pointer)
  }
}
