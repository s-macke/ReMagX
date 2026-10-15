// Nelder-Mead downhill simplex, written from the published algorithm (Nelder & Mead, Computer
// Journal 7, 1965; coefficients as in Lagarias et al., SIAM J. Optim. 9, 1998). Optional
// simulated annealing adds thermal noise to the compared function values, with a temperature that
// shrinks every iteration. Not derived from Numerical Recipes code (D-32).

export interface NelderMeadOptions {
  start: number[]
  steps: number[] // initial simplex edge per dimension
  lowerBounds: number[]
  upperBounds: number[]
  maxIterations: number
  tolerance: number // stop when the spread of function values falls below this
  annealing?: { temperature: number; temperatureStep: number; random: () => number }
}

export interface NelderMeadState {
  iteration: number
  best: number[]
  bestValue: number
}

const REFLECT = 1
const EXPAND = 2
const CONTRACT = 0.5
const SHRINK = 0.5

// Runs the optimizer as a generator: one yield per iteration, so callers can report progress,
// give the event loop a turn and stop early.
export function* nelderMead(
  objective: (x: number[]) => number,
  options: NelderMeadOptions,
): Generator<NelderMeadState, NelderMeadState> {
  const n = options.start.length
  const clamp = (x: number[]) =>
    x.map((v, i) => Math.min(options.upperBounds[i], Math.max(options.lowerBounds[i], v)))
  const evaluate = (x: number[]) => {
    const value = objective(x)
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
  }

  let temperature = options.annealing?.temperature ?? 0
  // Annealing: a positive, temperature-scaled fluctuation that makes worse points look better
  // occasionally, so the simplex can escape local minima.
  const noisy = (value: number) =>
    temperature > 0 && options.annealing ? value - temperature * Math.log(options.annealing.random()) : value

  let simplex: number[][] = [clamp(options.start)]
  for (let i = 0; i < n; i++) {
    const vertex = [...options.start]
    vertex[i] += options.steps[i] !== 0 ? options.steps[i] : 0.05 * (Math.abs(vertex[i]) || 1)
    simplex.push(clamp(vertex))
  }
  let values = simplex.map(evaluate)

  let best = { iteration: 0, best: simplex[0], bestValue: values[0] }
  const recordBest = (iteration: number) => {
    for (let i = 0; i < values.length; i++) {
      if (values[i] < best.bestValue) best = { iteration, best: simplex[i], bestValue: values[i] }
    }
    best = { ...best, iteration }
  }
  recordBest(0)

  for (let iteration = 1; iteration <= options.maxIterations; iteration++) {
    // Order vertices by (possibly noisy) value.
    const perceived = values.map(noisy)
    const order = perceived.map((_, i) => i).sort((a, b) => perceived[a] - perceived[b])
    simplex = order.map((i) => simplex[i])
    values = order.map((i) => values[i])
    const ranked = order.map((i) => perceived[i])

    if (n === 0 || Math.abs(values[n] - values[0]) <= options.tolerance * (Math.abs(values[0]) + 1e-300)) {
      recordBest(iteration)
      return best
    }

    const centroid = Array.from({ length: n }, (_, d) => simplex.slice(0, n).reduce((s, v) => s + v[d], 0) / n)
    const towards = (factor: number) => clamp(centroid.map((c, d) => c + factor * (c - simplex[n][d])))

    const reflected = towards(REFLECT)
    const reflectedValue = evaluate(reflected)
    const reflectedRank = noisy(reflectedValue)

    if (reflectedRank < ranked[0]) {
      const expanded = towards(EXPAND)
      const expandedValue = evaluate(expanded)
      if (noisy(expandedValue) < reflectedRank) {
        simplex[n] = expanded
        values[n] = expandedValue
      } else {
        simplex[n] = reflected
        values[n] = reflectedValue
      }
    } else if (reflectedRank < ranked[n - 1]) {
      simplex[n] = reflected
      values[n] = reflectedValue
    } else {
      const outside = reflectedRank < ranked[n]
      const contracted = towards(outside ? CONTRACT : -CONTRACT)
      const contractedValue = evaluate(contracted)
      if (noisy(contractedValue) < (outside ? reflectedRank : ranked[n])) {
        simplex[n] = contracted
        values[n] = contractedValue
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = clamp(simplex[i].map((v, d) => simplex[0][d] + SHRINK * (v - simplex[0][d])))
          values[i] = evaluate(simplex[i])
        }
      }
    }

    if (options.annealing) temperature *= 1 + options.annealing.temperatureStep
    recordBest(iteration)
    yield best
  }
  return best
}
