// Prepared aligned data only. Dataset adaptation, weights and regularization are separate.
export function calculateFitError(module, {
  mode, qz, energy = null, measured, calculated, measuredSecond = null, calculatedSecond = null,
  qzMin, qzMax, energyMin = 0, energyMax = 0, residuals = null,
}) {
  const vector = (values, count) => (Array.isArray(values) || values instanceof Float64Array) &&
    values.length === count && Array.from(values).every(Number.isFinite)
  const count = qz?.length
  const energyWindow = mode === 4 || mode === 5
  const dichroic = mode === 3 || mode === 7
  if (!Number.isInteger(mode) || mode < 0 || mode > 7 || !Number.isSafeInteger(count) ||
      !vector(qz, count) || !vector(measured, count) || !vector(calculated, count) ||
      (energyWindow && (!vector(energy, count) || !Number.isFinite(energyMin) || !Number.isFinite(energyMax))) ||
      (dichroic && (!vector(measuredSecond, count) || !vector(calculatedSecond, count))) ||
      !Number.isFinite(qzMin) || !Number.isFinite(qzMax) || (residuals !== null && !vector(residuals, count))) {
    throw new TypeError('Invalid prepared fit-error input')
  }
  const allocations = []
  const allocate = size => {
    const bytes = size * 8
    if (!Number.isSafeInteger(bytes) || bytes > 0x7fffffff) throw new RangeError('Fit-error buffer too large')
    if (!size) return 0
    const pointer = module._malloc(bytes)
    if (!pointer) throw Object.assign(new Error('Fit-error allocation failed'), { status: 3 })
    allocations.push(pointer)
    return pointer
  }
  try {
    const columns = [qz, energyWindow ? energy : null, measured, calculated,
      dichroic ? measuredSecond : null, dichroic ? calculatedSecond : null, residuals]
    const pointers = columns.map(column => column === null ? 0 : allocate(count))
    const output = allocate(1), accepted = allocate(1)
    columns.forEach((column, index) => { if (pointers[index]) module.HEAPF64.set(column, pointers[index] / 8) })
    const status = module._remagx_fit_dataset_error(mode, ...pointers.slice(0, 6), count,
      qzMin, qzMax, energyWindow ? energyMin : 0, energyWindow ? energyMax : 0, output, accepted, pointers[6])
    if (status !== 0) {
      const error = new Error(`Dataset fit error failed (status ${status})`)
      error.status = status
      throw error
    }
    return { error: module.HEAPF64[output / 8],
      accepted: new DataView(module.HEAPF64.buffer).getUint32(accepted, true),
      residuals: residuals === null ? null : module.HEAPF64.slice(pointers[6] / 8, pointers[6] / 8 + count) }
  } finally { for (const pointer of allocations) module._free(pointer) }
}
