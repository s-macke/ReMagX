import type { Project } from './project'

// CDataSet::PostModifications: normalized asymmetry is zero when the sum is zero.
export function unpackParrattResult(qz: number[], values: Float64Array, definition: Project['calculation']['asymmetryDefinition']) {
  if (values.length !== qz.length * 2 || !values.every(Number.isFinite)) throw new Error('The real engine returned invalid reflectivity values.')
  const reflectivityPlus = qz.map((_, index) => values[index * 2])
  const reflectivityMinus = qz.map((_, index) => values[index * 2 + 1])
  const asymmetry = reflectivityPlus.map((plus, index) => {
    const minus = reflectivityMinus[index]
    return definition === 'difference' ? plus - minus : plus + minus !== 0 ? (plus - minus) / (plus + minus) : 0
  })
  if (!asymmetry.every(Number.isFinite)) throw new Error('The real engine asymmetry exceeds the supported numerical range.')
  return { qz: [...qz], reflectivityPlus, reflectivityMinus, asymmetry }
}
