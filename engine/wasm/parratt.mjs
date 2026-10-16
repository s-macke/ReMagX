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

function checkStatus(status, operation = 'Parratt calculation') {
  if (status !== 0) {
    const error = new Error(`${operation} failed (status ${status})`)
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
  layers, qz, energy, beam1, beam2 = null, tensor = 0, analyzer = 0, magnetic = 1, mode = 1, resolution,
}) {
  if (!validRows(layers, 8) || layers.length < 2 || !validVector(qz) ||
      !Number.isFinite(energy) || energy <= 0 || !validVector(beam1, 4) ||
      (mode === 1 && !validVector(beam2, 4)) || ![0, 1].includes(mode) ||
      ![0, 1].includes(magnetic) || ![0, 1].includes(tensor) || ![0, 1, 2].includes(analyzer)) {
    throw new TypeError('Invalid prepared Parratt qz input')
  }
  if (resolution !== undefined && (!resolution || !Number.isFinite(resolution.width) || resolution.width < 0 || typeof resolution.fast !== 'boolean')) {
    throw new TypeError('Invalid angular-resolution settings')
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
    const argumentsBeforeOutput = [layerPointer, layers.length, qzPointer, qz.length,
      energy, firstBeamPointer, secondBeamPointer, tensor, analyzer, magnetic, mode]
    const status = resolution
      ? module._remagx_parratt_qz_resolution(...argumentsBeforeOutput, resolution.width, Number(resolution.fast), outputPointer)
      : module._remagx_parratt_qz(...argumentsBeforeOutput, outputPointer)
    checkStatus(status)
    return module.HEAPF64.slice(outputPointer / 8, outputPointer / 8 + qz.length * 2)
  })
}

function validVector(values, length, allowEmpty = false) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || (length !== undefined && values.length !== length)) return false
  // for-of visits holes as undefined; Array.every would silently skip them.
  for (const value of values) if (!Number.isFinite(value)) return false
  return true
}

function validRows(rows, width) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  for (const row of rows) if (!validVector(row, width)) return false
  return true
}

// OpticalTable-shaped input (column-oriented), native row-major output. Cursor
// is returned explicitly, so repeated batches retain legacy duplicate-energy history.
export function lookupTable(module, table, queries, cursor = 0) {
  if (!table || !validVector(table.energy, undefined, true) ||
      !Array.isArray(table.columns) || table.columns.length < 1 || table.columns.length > 20 ||
      !Array.from(table.columns).every(column => validVector(column, table.energy.length, true)) ||
      !validVector(queries) || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > 0xffffffff) {
    throw new TypeError('Invalid optical-table lookup input')
  }
  return withBuffers(module, allocate => {
    const rows = table.energy.length
    const columns = table.columns.length
    const energyPointer = rows ? allocate(rows) : 0
    const valuePointer = rows ? allocate(rows * columns) : 0
    const queryPointer = allocate(queries.length)
    const cursorPointer = allocate(1)
    const outputPointer = allocate(queries.length * columns)
    if (rows) module.HEAPF64.set(table.energy, energyPointer / 8)
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      module.HEAPF64[valuePointer / 8 + row * columns + column] = table.columns[column][row]
    }
    module.HEAPF64.set(queries, queryPointer / 8)
    // wasm32 size_t is four bytes; the allocation remains aligned to eight bytes.
    new DataView(module.HEAPF64.buffer).setUint32(cursorPointer, cursor, true)
    checkStatus(module._remagx_table_lookup(energyPointer, valuePointer, rows, columns,
      queryPointer, queries.length, cursorPointer, outputPointer), 'Optical-table lookup')
    return {
      values: module.HEAPF64.slice(outputPointer / 8, outputPointer / 8 + queries.length * columns),
      cursor: new DataView(module.HEAPF64.buffer).getUint32(cursorPointer, true),
    }
  })
}

// Both intensity columns are convolved before asymmetry and postprocessing.
export function convolveEnergy(module, energies, values, width) {
  if (!validVector(energies) || !(values instanceof Float64Array) || values.length !== energies.length * 2 ||
      !values.every(Number.isFinite) || !Number.isFinite(width) || width < 0) {
    throw new TypeError('Invalid energy-resolution input')
  }
  return withBuffers(module, allocate => {
    const energyPointer = allocate(energies.length)
    const valuePointer = allocate(values.length)
    const outputPointer = allocate(values.length)
    module.HEAPF64.set(energies, energyPointer / 8)
    module.HEAPF64.set(values, valuePointer / 8)
    checkStatus(module._remagx_energy_resolution(energyPointer, valuePointer, energies.length, width, outputPointer), 'Energy convolution')
    return module.HEAPF64.slice(outputPointer / 8, outputPointer / 8 + values.length)
  })
}
