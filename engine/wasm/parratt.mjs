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

// One prepared stack per energy; skipped points retain native legacy initialization.
export function calculateParrattEnergyScan(module, { stacks, energy, qz, enabled, beam1, beam2,
  tensor, analyzer, magnetic, mode, angularWidth, energyWidth }) {
  const layerCount = stacks?.[0]?.length
  if (!validVector(energy) || !energy.every(value => value > 0) || !validVector(qz, energy.length) ||
      !validVector(enabled, energy.length) || !enabled.every(value => value === 0 || value === 1) ||
      !Array.isArray(stacks) || stacks.length !== energy.length || !Number.isSafeInteger(layerCount) || layerCount < 2 ||
      !Array.from(stacks).every(stack => validRows(stack, 8) && stack.length === layerCount) ||
      !validVector(beam1, 4) || (mode === 1 && !validVector(beam2, 4)) ||
      ![0, 1].includes(mode) || ![0, 1].includes(magnetic) || ![0, 1].includes(tensor) || ![0, 1, 2].includes(analyzer) ||
      !Number.isFinite(angularWidth) || angularWidth < 0 || !Number.isFinite(energyWidth) || energyWidth < 0) {
    throw new TypeError('Invalid prepared energy-scan input')
  }
  return withBuffers(module, allocate => {
    const layerPointer = allocate(stacks.length * layerCount * 8)
    const energyPointer = allocate(energy.length)
    const qzPointer = allocate(qz.length)
    const enabledPointer = allocate(enabled.length) // aligned storage for wasm32 int
    const firstPointer = allocate(4)
    const secondPointer = mode === 1 ? allocate(4) : 0
    const outputPointer = allocate(energy.length * 2)
    stacks.forEach((stack, index) => module.HEAPF64.set(stack.flat(), layerPointer / 8 + index * layerCount * 8))
    module.HEAPF64.set(energy, energyPointer / 8)
    module.HEAPF64.set(qz, qzPointer / 8)
    const view = new DataView(module.HEAPF64.buffer)
    enabled.forEach((value, index) => view.setInt32(enabledPointer + index * 4, value, true))
    module.HEAPF64.set(beam1, firstPointer / 8)
    if (secondPointer) module.HEAPF64.set(beam2, secondPointer / 8)
    checkStatus(module._remagx_parratt_energy_scan(layerPointer, layerCount, energyPointer, qzPointer,
      enabledPointer, energy.length, firstPointer, secondPointer, tensor, analyzer, magnetic, mode,
      angularWidth, energyWidth, outputPointer), 'Energy scan')
    return module.HEAPF64.slice(outputPointer / 8, outputPointer / 8 + energy.length * 2)
  })
}

// Scalar optical constants to a row-major complex 3x3 dielectric tensor.
export function calculateDielectricTensor(module, { layer, tensor = 0, magnetic = 1 }) {
  if (!validVector(layer, 8) || ![0, 1].includes(tensor) || ![0, 1].includes(magnetic)) {
    throw new TypeError('Invalid dielectric-tensor input')
  }
  return withBuffers(module, allocate => {
    const layerPointer = allocate(8)
    const outputPointer = allocate(18)
    const kindPointer = allocate(1)
    module.HEAPF64.set(layer, layerPointer / 8)
    checkStatus(module._remagx_dielectric_tensor(layerPointer, tensor, magnetic, outputPointer, kindPointer), 'Dielectric tensor')
    const kind = new DataView(module.HEAPF64.buffer).getInt32(kindPointer, true)
    if (kind !== 0 && kind !== 1) throw new Error('Invalid dielectric-tensor classification')
    return { values: module.HEAPF64.slice(outputPointer / 8, outputPointer / 8 + 18), anisotropic: kind === 1 }
  })
}

// One angle for a prepared substrate-first tensor stack. Both beams see the
// supplied tensors; the caller prepares any magnetization-reversed stack.
export function calculateVisnovsky(module, { layers, angle, waveNumber, epsilon, beam1, beam2, analyzer = 0 }) {
  if (!Array.isArray(layers) || layers.length < 2 || !Array.from(layers).every(layer =>
      layer && validVector(layer.values, 22) && [0, 1].includes(layer.anisotropic)) ||
      !Number.isFinite(angle) || !Number.isFinite(waveNumber) || !Number.isFinite(epsilon) ||
      !validVector(beam1, 4) || !validVector(beam2, 4) || ![0, 1, 2].includes(analyzer)) {
    throw new TypeError('Invalid prepared Visnovsky input')
  }
  return withBuffers(module, allocate => {
    const layerPointer = allocate(layers.length * 23)
    const firstPointer = allocate(4)
    const secondPointer = allocate(4)
    const outputPointer = allocate(2)
    const view = new DataView(module.HEAPF64.buffer)
    layers.forEach((layer, index) => {
      const offset = layerPointer + index * 184
      module.HEAPF64.set(layer.values, offset / 8)
      view.setInt32(offset + 176, layer.anisotropic, true)
      view.setInt32(offset + 180, 0, true) // trailing ABI padding
    })
    module.HEAPF64.set(beam1, firstPointer / 8)
    module.HEAPF64.set(beam2, secondPointer / 8)
    checkStatus(module._remagx_visnovsky(layerPointer, layers.length, angle, waveNumber, epsilon,
      firstPointer, secondPointer, analyzer, outputPointer), 'Visnovsky reflection')
    return module.HEAPF64.slice(outputPointer / 8, outputPointer / 8 + 2)
  })
}
