import type { FitParameter } from './project'

// CChiSquareFit's metadata constructor replaces every saved delta with this
// scale. This is initialization metadata, not the private optimizer algorithm.
function initialStep(value: number, upperBound: number): number {
  let step = Math.abs(.05 * value)
  if (step <= 1e-7) step = Math.abs(.05 * upperBound)
  return step <= 1e-7 ? 1e-8 : step
}

// A dimensionless axis simplex for the clean-room optimizer (D-32). Fixed rows
// remain in decoded candidates but are excluded from the optimization dimensions.
// One coordinate unit is the actual bounded initial displacement, so nanometre
// thicknesses and tiny optical constants do not share an absolute stopping scale.
export function prepareRealFitSimplex(parameters: readonly FitParameter[]) {
  const origins = parameters.map((parameter, index) => {
    if (![parameter.value, parameter.lowerBound, parameter.upperBound].every(Number.isFinite) ||
        parameter.lowerBound > parameter.upperBound) throw new Error(`Invalid value or bounds for fit parameter ${index + 1}.`)
    let value = parameter.value
    if (value < parameter.lowerBound) value = parameter.lowerBound
    if (value > parameter.upperBound) value = parameter.upperBound
    return value
  })
  const axes: { index: number; scale: number }[] = []
  parameters.forEach((parameter, index) => {
    if (parameter.lowerBound === parameter.upperBound) return
    const origin = origins[index]
    const step = initialStep(parameter.value, parameter.upperBound)
    let other = Math.min(parameter.upperBound, origin + step)
    if (other === origin) other = Math.max(parameter.lowerBound, origin - step)
    // If addition rounded back to the origin, an endpoint still gives a
    // representable displacement for a nonzero-width interval.
    if (other === origin) other = origin !== parameter.upperBound ? parameter.upperBound : parameter.lowerBound
    const scale = other - origin
    if (!Number.isFinite(scale) || scale === 0) throw new Error(`Cannot initialize fit parameter ${index + 1} within its bounds.`)
    axes.push({ index, scale })
  })
  const simplex = axes.length ? Array.from({ length: axes.length + 1 }, (_, vertex) =>
    axes.map((_, axis) => Number(vertex === axis + 1))) : []
  return {
    simplex,
    // No free dimensions: evaluate decode([]) once without invoking the optimizer.
    decode(coordinates: readonly number[] | Float64Array): number[] {
      if (coordinates.length !== axes.length || !Array.from(coordinates).every(Number.isFinite)) {
        throw new Error('Invalid normalized fit candidate.')
      }
      const values = origins.slice()
      axes.forEach(({ index, scale }, axis) => {
        const value = coordinates[axis] === 0 ? origins[index] : origins[index] + coordinates[axis] * scale
        if (!Number.isFinite(value)) throw new Error('Fit candidate exceeds the supported numerical range.')
        values[index] = value
      })
      return values // applyRealFitParameters performs ordered clipping at evaluation.
    },
  }
}
