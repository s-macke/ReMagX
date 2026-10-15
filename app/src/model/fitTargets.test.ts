import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { createFitParameter, fitParameterName, readFitTarget, writeFitTarget } from './fitTargets'
import { normalizeBeam, presetOfBeam } from './presets'

describe('fit targets', () => {
  it('reads and writes layer quantities', () => {
    const project = createDefaultProject()
    const parameter = createFitParameter(project, 'roughness', 3, null)
    expect(parameter).toMatchObject({ value: 5, lowerBound: 2.5, upperBound: 7.5 })
    expect(fitParameterName(project, parameter)).toBe('σ (layer 3)')
    expect(writeFitTarget(project, parameter, 4)).toBe(true)
    expect(project.sample.layers[3].roughness).toBe(4)
  })

  it('reports missing targets instead of writing elsewhere', () => {
    const project = createDefaultProject()
    const intensity = createFitParameter(project, 'intensityScale', null, null)
    expect(readFitTarget(project, intensity)).toBeUndefined() // no active dataset
    expect(writeFitTarget(project, { ...intensity, target: 'thickness', index: 99 }, 1)).toBe(false)
  })

  it('names the substrate and ambient like the legacy table', () => {
    const project = createDefaultProject()
    expect(fitParameterName(project, createFitParameter(project, 'delta', 0, null))).toBe('δ (bulk)')
    expect(fitParameterName(project, createFitParameter(project, 'delta', 13, null))).toBe('δ (air)')
  })
})

describe('polarization presets', () => {
  it('recognizes the circular default and normalizes beams', () => {
    const { beam1, beam2 } = createDefaultProject().experiment.polarization
    expect(presetOfBeam(beam1)).toBe('left-circular')
    expect(presetOfBeam(beam2)).toBe('right-circular')
    const normalized = normalizeBeam({ sigma: { re: 1, im: 0 }, pi: { re: 0, im: 1 } })
    expect(presetOfBeam(normalized)).toBe('left-circular')
  })
})
