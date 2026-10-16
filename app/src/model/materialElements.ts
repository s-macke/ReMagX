import { legacyAtomicMasses } from './legacyAtomicMasses'
import { fitTargetInfo } from './fitTargets'
import { elementProfileSchema, type ElementProfile, type Project } from './project'

export interface ElementConversion { elements: ElementProfile[]; warnings: string[] }

// Legacy formula grammar: symbols, optional single-digit [index], integer counts
// of up to three digits. Preserve repeated-symbol overwrite and first mass lookup.
export function formulaContributions(formula: string, density: number) {
  const tokens: { symbol: string; count: number; mass: number }[] = []
  const warnings: string[] = []
  let remainder = formula
  while (remainder) {
    const match = /^([A-Z][a-z]?)(\[[0-9]\])?([0-9]{1,3})?/.exec(remainder)
    if (!match) throw new Error(`Unsupported formula syntax: ${formula}`)
    const [, symbol, annotation, count] = match
    const entry = legacyAtomicMasses.find(([name]) => name === symbol)
    if (!entry || entry[1] <= 0) throw new Error(`Unknown legacy element or mass: ${symbol}`)
    if (annotation) warnings.push(`${symbol}${annotation}: index annotations are ignored by legacy material-to-elements conversion.`)
    if (tokens.some(token => token.symbol === symbol)) warnings.push(`${symbol}: repeated symbols overwrite earlier density contributions, as in legacy.`)
    if (symbol === 'Ti') warnings.push('Ti uses the first legacy entry (titanium); the legacy table has a duplicate Ti entry in place of Tl.')
    tokens.push({ symbol, count: count === undefined ? 1 : Number(count), mass: entry[1] })
    remainder = remainder.slice(match[0].length)
  }
  const molarMass = tokens.reduce((sum, token) => sum + token.mass * token.count, 0)
  if (!Number.isFinite(density) || density < 0 || !Number.isFinite(molarMass) || molarMass <= 0) throw new Error('Formula needs a positive molar mass and finite nonnegative density.')
  const contributions = tokens.map(token => ({ symbol: token.symbol, density: density * token.count / molarMass }))
  if (contributions.some(entry => !Number.isFinite(entry.density))) throw new Error('Element density exceeds the supported numeric range.')
  return { contributions, warnings }
}

// Invoked only by the worker. The mock does not run multilayer/Lua expansion.
export function convertMaterialElements(project: Project): ElementConversion {
  if (project.sample.multilayer.enabled) throw new Error('Material to Elements needs multilayer-script expansion, which is not available in the mock engine.')
  const elements: ElementProfile[] = []
  const warnings: string[] = []
  project.sample.layers.forEach((layer, index) => {
    if (!layer.material || layer.density === 0) { warnings.push(`Layer ${index}: empty formula or zero density contributes no elements.`); return }
    try {
      const result = formulaContributions(layer.material, layer.density)
      warnings.push(...result.warnings.map(warning => `Layer ${index}: ${warning}`))
      for (const contribution of result.contributions) {
        let element = elements.find(element => element.element === contribution.symbol)
        if (!element) {
          element = { element: contribution.symbol, f1: 0, f2: 0, f1Mag: 0, f2Mag: 0, slabs: project.sample.layers.map(layer => ({ thickness: layer.thickness, roughness: layer.roughness, density: 0 })) }
          elements.push(element)
        }
        element.slabs[index].density = contribution.density
      }
    } catch (error) { warnings.push(`Layer ${index} skipped: ${(error as Error).message}`) }
  })
  return { elements, warnings }
}

export function applyElementConversion(project: Project, result: ElementConversion): { project: Project; removedFits: number } {
  if (!result.elements.length || result.elements.some(element => !elementProfileSchema.safeParse(element).success || element.slabs.length !== project.sample.layers.length)) throw new Error('No valid element stacks were generated.')
  const parameters = project.fit.parameters.filter(parameter => !['element', 'elementSlab'].includes(fitTargetInfo[parameter.target].index))
  return { project: { ...project, sample: { ...project.sample, mode: 'element', elementProfiles: structuredClone(result.elements) }, fit: { ...project.fit, parameters } }, removedFits: project.fit.parameters.length - parameters.length }
}
