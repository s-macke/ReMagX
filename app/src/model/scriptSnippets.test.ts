import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { generateSnippet } from './scriptSnippets'

describe('script code generator', () => {
  it('writes beta/delta ratios for layers with delta, skipping the ambient', () => {
    const lines = generateSnippet('deltaBetaRatio', createDefaultProject())
    expect(lines).toHaveLength(13)
    expect(lines[1]).toBe(`beta[1] = ${0.0056168 / -0.003486} * delta[1]`)
  })

  it('writes magnetic ratios only for magnetic layers', () => {
    expect(generateSnippet('magneticRatio', createDefaultProject())).toHaveLength(6)
  })

  it('loops over all layers in the roughness check', () => {
    expect(generateSnippet('roughnessBoundaryCheck', createDefaultProject())[0]).toBe('for i = 0, 13, 1 do')
  })
})

it.each(['deltaBetaRatio', 'magneticRatio'] as const)('keeps layer indices and skips zero denominators and ambient for %s', kind => {
  const project = createDefaultProject()
  for (const layer of project.sample.layers) {
    layer.delta = layer.deltaMag = 1
    layer.beta = layer.betaMag = 1e-12
  }
  project.sample.layers[0].delta = project.sample.layers[0].deltaMag = 0
  const before = structuredClone(project)
  const lines = generateSnippet(kind, project)
  expect(lines).toHaveLength(project.sample.layers.length - 2)
  expect(lines[0]).toContain('[1] = 1e-12 * ')
  expect(lines.some(line => line.includes(`[${project.sample.layers.length - 1}]`))).toBe(false)
  expect(project).toEqual(before)
})
