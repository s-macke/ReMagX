// Active 19-point Gaussian quadrature from shared/RechenHilfe.h. Preserve the
// printed constants, order and unnormalized truncated/negative-qz contributions.
const offsets = [-2, -1.77777777777778, -1.55555555555556, -1.33333333333333,
  -1.11111111111111, -.888888888888889, -.666666666666667, -.444444444444444,
  -.222222222222222, 0, .222222222222222, .444444444444444, .666666666666667,
  .888888888888889, 1.11111111111111, 1.33333333333333, 1.55555555555556, 1.77777777777778, 2]
const weights = [.00377799105508597, .00543307167196355, .0113273887261945,
  .0214123599246999, .0366987921471986, .0570286832606567, .0803509037851472,
  .102646753546022, .118893345923233, .124861419919597, .118893345923233,
  .102646753546022, .0803509037851472, .0570286832606567, .0366987921471986,
  .0214123599246999, .0113273887261945, .00543307167196355, .00377799105508597]

function validateWidth(width: number) {
  if (!Number.isFinite(width) || width < 0) throw new Error('Angular resolution must be finite and nonnegative.')
}

export function angularResolutionCoordinates(qz: number[], width: number, fast: boolean): number[] {
  validateWidth(width)
  if (fast) return [...qz]
  const samples = width < 1e-10 ? [offsets[0]] : offsets
  const result = qz.flatMap(value => samples.map(offset => value + offset * width))
  if (!result.every(Number.isFinite)) throw new Error('Angular-resolution coordinates exceed the numerical range.')
  return result
}

// RechenHilfe.cpp GetLinY, including the omitted last interval on forward searches
// and fallback to the original point, rather than endpoint clamping/extrapolation.
function interpolate(qz: number[], values: Float64Array, position: number, target: number, beam: number) {
  const linear = (left: number, right: number) => values[left * 2 + beam] -
    (qz[left] - target) / (qz[left] - qz[right]) * (values[left * 2 + beam] - values[right * 2 + beam])
  if (qz[position] < target) {
    for (let index = position + 1; index < qz.length - 1; index++) {
      if (qz[index] > target) return linear(index - 1, index)
    }
  } else {
    for (let index = position - 1; index >= 0; index--) {
      if (qz[index] < target) return linear(index, index + 1)
    }
  }
  return values[position * 2 + beam]
}

export function combineAngularResolution(qz: number[], values: Float64Array, width: number, fast: boolean, dichroic: boolean): Float64Array {
  validateWidth(width)
  const count = width < 1e-10 && !fast ? 1 : offsets.length
  if (values.length !== qz.length * 2 * (fast ? 1 : count) || !values.every(Number.isFinite)) {
    throw new Error('Invalid angular-resolution calculation output.')
  }
  const source = values.slice()
  if (fast) {
    // Legacy fast curves initialize Rp/Rm to one before skipping negative angles.
    for (let index = 0; index < qz.length; index++) if (qz[index] < 0) {
      source[index * 2] = 1
      source[index * 2 + 1] = dichroic ? 1 : 0
    }
  }
  const result = new Float64Array(qz.length * 2)
  for (let index = 0; index < qz.length; index++) {
    for (let sample = 0; sample < count; sample++) {
      const weight = count === 1 ? 1 : weights[sample]
      const coordinate = qz[index] + offsets[sample] * width
      if (fast && coordinate < 0) continue
      for (let beam = 0; beam < (dichroic ? 2 : 1); beam++) {
        const intensity = fast ? interpolate(qz, source, index, coordinate, beam) : source[(index * count + sample) * 2 + beam]
        result[index * 2 + beam] += weight * intensity
      }
    }
  }
  if (!result.every(Number.isFinite)) throw new Error('Angular convolution exceeds the supported numerical range.')
  return result
}
