import type { RealMinimizer } from './realFit'
import { prepareRealFitSimplex } from './realFitSimplex'
import type { PlotArea, PlotLineSource } from './plotArea'
import { selectedLineSamples } from './plotArea'

export interface LineFitRequest { source: PlotLineSource; area: PlotArea }
export interface LineFitResult {
  sourceLabel: string
  x: number[]
  y: number[]
  parameters: number[] // area, width, center, background, step height, step steepness
  squaredError: number
  iterations: number
  termination: string
}

// Published Lorentzian with constant background and smooth tanh step, matching
// the original chart-only objective. This is not reflectivity or a dataset chi².
export function lorentzianStepValue(x: number, parameters: readonly number[]): number {
  const [area, width, center, background, height, steepness] = parameters
  return 2 * area / Math.PI * width / (4 * (x - center) * (x - center) + width * width)
    + background + height * .5 * (Math.tanh((x - center) * steepness) + 1)
}

export function prepareLorentzianStep(request: LineFitRequest) {
  const source = selectedLineSamples(request.source, request.area)
  let maximum = -Infinity, minimum = Infinity, center = source.x[0]
  source.y.forEach((value, index) => {
    if (value > maximum) { maximum = value; center = source.x[index] }
    minimum = Math.min(minimum, value)
  })
  // The original constructs reversed background bounds for negative minima.
  // Retain explicit unavailability instead of silently inventing new bounds.
  if (minimum < 0) throw new Error('Lorentzian+Step with a negative background has invalid legacy bounds and is not supported.')
  if (!(maximum > 1e-99)) throw new Error('Lorentzian+Step needs a positive selected maximum above the legacy 1e-99 seed threshold.')
  const start = [8 * (maximum - minimum) / Math.PI, 2, center, minimum, source.y.at(-1)! - minimum, 1]
  const lower = [0, 0, center - 1, minimum * .8, -1e99, 0]
  const upper = [1e99, 1e99, center + 1, minimum * 1.2, 1e99, 10]
  if (![...start, ...lower, ...upper].every(Number.isFinite)) throw new Error('Line-fit initialization exceeds the supported numerical range.')
  return { source, start, lower, upper }
}

export function lineFitText(result: LineFitResult): string {
  return ['# Lorentzian+Step: ' + result.sourceLabel.replace(/[\r\n]/g, ' '),
    ...['A', 'G', 'E', 'M', 'S', 'O'].map((name, index) => `${name} = ${result.parameters[index]}`),
    'Re = -2*A/Pi * 2*(E-e) / (4*(E-e)*(E-e) + G*G)',
    'Im = 2*A/Pi * G / (4*(E-e)*(E-e) + G*G) + S*0.5*(tanh((e-E)*O)+1) + M',
    `Squared error = ${result.squaredError}`, `Termination = ${result.termination}`].join('\n')
}


// Worker-only orchestration with the existing clean-room native/WASM optimizer.
// Keep the best actually evaluated bounded candidate, so curve and export agree.
export function fitLorentzianStep(request: LineFitRequest, minimize: RealMinimizer): LineFitResult {
  const { source, start, lower, upper } = prepareLorentzianStep(request)
  const prepared = prepareRealFitSimplex(start.map((value, index) => ({ value, lowerBound: lower[index], upperBound: upper[index] })))
  let bestParameters = start.slice(), bestError = Infinity
  const evaluate = (coordinates: Float64Array): number => {
    const parameters = prepared.decode(coordinates).map((value, index) => Math.max(lower[index], Math.min(upper[index], value)))
    let error = 0
    for (let index = 0; index < source.x.length; index++) {
      const residual = lorentzianStepValue(source.x[index], parameters) - source.y[index]
      error += residual * residual
    }
    if (!Number.isFinite(error)) throw new Error('Lorentzian+Step produced an undefined or overflowing value; check the selected range and peak width.')
    if (error < bestError) { bestError = error; bestParameters = parameters.slice() }
    return error
  }
  evaluate(new Float64Array(prepared.simplex[0]))
  const result = minimize({ simplex: prepared.simplex, objective: evaluate, shouldStop: () => false, onProgress: () => {} })
  if (result.termination === 'stopped') throw new Error('Line fit stopped before completion.')
  if (!Number.isFinite(bestError)) throw new Error('Line fitting did not produce a finite result.')
  return { sourceLabel: source.label, x: source.x.slice(), y: source.x.map(x => lorentzianStepValue(x, bestParameters)),
    parameters: bestParameters, squaredError: bestError, iterations: result.iterations, termination: result.termination }
}
