// CMultiFit::Error adds this term after the weighted dataset errors. The caller
// must supply the optimizer's reference vector (legacy activevars), not assume
// that it is the initial project values. All currently supported fit targets use
// this term; the extra BETALIST adjacency term belongs to deferred KK fitting.
export function addFitRegularization(error: number, weight: number,
  reference: readonly number[], candidate: readonly number[]): number {
  if (!Number.isFinite(error) || !Number.isFinite(weight) || reference.length !== candidate.length ||
      !Array.from(reference).every(Number.isFinite) || !Array.from(candidate).every(Number.isFinite)) {
    throw new Error('Invalid fit regularization inputs.')
  }
  if (weight === 0) return error
  let total = error
  for (let index = 0; index < candidate.length; index++) {
    // The legacy threshold tests the current candidate, not the reference.
    if (Math.abs(candidate[index]) < 1e-6) continue
    const difference = reference[index] - candidate[index]
    // Keep multiplication and accumulation order; do not pre-sum squares.
    total += weight * difference * difference
    if (!Number.isFinite(total)) throw new Error('Fit regularization exceeds the supported numerical range.')
  }
  return total
}
