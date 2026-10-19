import type { Project } from './project'

// C API row: thickness, roughness, delta, beta, deltaMag, betaMag, gamma, phi.
export type PreparedCompoundLayer = [number, number, number, number, number, number, number, number]

// Legacy RechenHilfe.cpp Interpret/ExecuteMultilayer and CVector::Implement.
// Substrate and ambient are implicit; indices in the sequence can also name them.
// Retain digit concatenation across ignored characters and termination at a top-level ')'.
// Reject unterminated repetition and resource exhaustion instead of legacy undefined reads.
export function compoundLayerIndices(layerCount: number, pattern: string, maximumLayers = 100000): number[] {
  if (!Number.isSafeInteger(layerCount) || layerCount < 2 || !Number.isSafeInteger(maximumLayers) || maximumLayers < 2) {
    throw new Error('Invalid compound layer count or expansion limit.')
  }
  const limit = maximumLayers - 2
  function parse(start: number, depth: number): { indices: number[]; position: number } {
    if (depth > 128) throw new Error('Multilayer nesting exceeds the supported limit.')
    const indices: number[] = []
    let digits = ''
    let position = start
    while (position < pattern.length && pattern[position] !== ')' && pattern[position] !== '\0') {
      const character = pattern[position]
      if (character >= '0' && character <= '9') digits += character
      const next = pattern[position + 1]
      if (digits && (character === ',' || next === undefined || next === '\0' || next === ')' || character === '*')) {
        const value = Number(digits)
        if (!Number.isSafeInteger(value)) throw new Error('Multilayer integer exceeds the supported range.')
        if (character === '*') {
          if (next !== '(') throw new Error("Multilayer repetition requires '(' immediately after '*'.")
          const group = parse(position + 2, depth + 1)
          if (pattern[group.position] !== ')') throw new Error('Multilayer repetition is missing its closing parenthesis.')
          if (group.indices.length && value > Math.floor((limit - indices.length) / group.indices.length)) {
            throw new Error('Multilayer expansion exceeds the supported layer limit.')
          }
          if (group.indices.length) for (let repeat = 0; repeat < value; repeat++) {
            for (const index of group.indices) indices.push(index)
          }
          position = group.position
        } else {
          if (value >= layerCount) throw new Error(`Multilayer layer index ${value} is out of range.`)
          if (indices.length >= limit) throw new Error('Multilayer expansion exceeds the supported layer limit.')
          indices.push(value)
        }
        digits = ''
      }
      position++
    }
    return { indices, position }
  }
  return [0, ...parse(0, 0).indices, layerCount - 1]
}

export function prepareCompoundLayerIndices(project: Project): number[] {
  return project.sample.multilayer.enabled
    ? compoundLayerIndices(project.sample.layers.length, project.sample.multilayer.pattern)
    : project.sample.layers.map((_, index) => index)
}

// A stage of real-engine project preparation, not a complete calculation request.
// The caller must refresh tables and execute BeforeCalculation before packing layers.
// Legacy FillLayers copies constants directly, without multiplying them by density.
export function prepareCompoundLayers(project: Project): PreparedCompoundLayer[] {
  if (project.sample.mode !== 'compound') throw new Error('Element-mode preparation is not implemented yet.')
  // Original CalcMagProfile returns before applying any profile when slicing is off.
  // Profile mode therefore retains stored magnetic constants with Nevot–Croce.
  if (project.calculation.roughnessModel !== 'nevot-croce') throw new Error('Adaptive segmentation is not implemented in real-engine preparation yet.')
  const layers = project.sample.layers
  const indices = prepareCompoundLayerIndices(project)
  return indices.map(index => {
    const layer = layers[index]
    const row: PreparedCompoundLayer = [layer.thickness, layer.roughness, layer.delta, layer.beta,
      layer.deltaMag, layer.betaMag, layer.magnetization.gamma, layer.magnetization.phi]
    if (!row.every(Number.isFinite) || layer.thickness < 0 || layer.roughness < 0) {
      throw new Error(`Layer ${index} has invalid numerical values.`)
    }
    return row
  })
}
