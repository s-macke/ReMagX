import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { generateSnippet } from './scriptSnippets'

describe('script code generator', () => {
  it('writes beta/delta ratios for layers with delta, skipping the ambient', () => {
    const lines = generateSnippet('deltaBetaRatio', createDefaultProject())
    expect(lines).toHaveLength(13)
    expect(lines[1]).toBe(`beta[1] = ${(0.0056168 / -0.003486).toFixed(10)} * delta[1]`)
  })

  it('writes magnetic ratios only for magnetic layers', () => {
    expect(generateSnippet('magneticRatio', createDefaultProject())).toHaveLength(6)
  })

  it('loops over all layers in the roughness check', () => {
    expect(generateSnippet('roughnessBoundaryCheck', createDefaultProject())[0]).toBe('for i = 0, 13, 1 do')
  })
})
