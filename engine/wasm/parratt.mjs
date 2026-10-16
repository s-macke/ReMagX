// Prepared-stack adapter; higher-level project preparation belongs in the worker.
export function calculateParratt(module, { layers, points, beam, tensor = 0, analyzer = 0 }) {
  if (!validRows(layers, 8) || layers.length < 2 || !validRows(points, 3) ||
      !validVector(beam, 4) ||
      ![0, 1].includes(tensor) || ![0, 1, 2].includes(analyzer)) {
    throw new TypeError('Invalid prepared Parratt input')
  }
  return withBuffers(module, allocate => {
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
    checkStatus(status)
    return module.HEAPF64.slice(outputPointer / 8, outputPointer / 8 + points.length)
  })
}

function checkStatus(status) {
  if (status !== 0) {
    const error = new Error(`Parratt calculation failed (status ${status})`)
    error.status = status
    throw error
  }
}

function withBuffers(module, run) {
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
    return run(allocate)
  } finally {
    for (const pointer of allocations) module._free(pointer)
  }
}

// Returns interleaved beam1/beam2 intensities. Monochromatic beam2 values are zero.
export function calculateParrattQz(module, {
  layers, qz, energy, beam1, beam2 = null, tensor = 0, analyzer = 0, magnetic = 1, mode = 1,
}) {
  if (!validRows(layers, 8) || layers.length < 2 || !validVector(qz) ||
      !Number.isFinite(energy) || energy <= 0 || !validVector(beam1, 4) ||
      (mode === 1 && !validVector(beam2, 4)) || ![0, 1].includes(mode) ||
      ![0, 1].includes(magnetic) || ![0, 1].includes(tensor) || ![0, 1, 2].includes(analyzer)) {
    throw new TypeError('Invalid prepared Parratt qz input')
  }
  return withBuffers(module, allocate => {
    const layerPointer = allocate(layers.length * 8)
    const qzPointer = allocate(qz.length)
    const firstBeamPointer = allocate(4)
    const secondBeamPointer = mode === 1 ? allocate(4) : 0
    const outputPointer = allocate(qz.length * 2)
    module.HEAPF64.set(layers.flat(), layerPointer / 8)
    module.HEAPF64.set(qz, qzPointer / 8)
    module.HEAPF64.set(beam1, firstBeamPointer / 8)
    if (secondBeamPointer) module.HEAPF64.set(beam2, secondBeamPointer / 8)
    checkStatus(module._remagx_parratt_qz(layerPointer, layers.length, qzPointer, qz.length,
      energy, firstBeamPointer, secondBeamPointer, tensor, analyzer, magnetic, mode, outputPointer))
    return module.HEAPF64.slice(outputPointer / 8, outputPointer / 8 + qz.length * 2)
  })
}

function validVector(values, length) {
  if (!Array.isArray(values) || values.length === 0 || (length !== undefined && values.length !== length)) return false
  // for-of visits holes as undefined; Array.every would silently skip them.
  for (const value of values) if (!Number.isFinite(value)) return false
  return true
}

function validRows(rows, width) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  for (const row of rows) if (!validVector(row, width)) return false
  return true
}
