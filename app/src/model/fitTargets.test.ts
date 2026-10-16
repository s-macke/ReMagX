import { describe, expect, it } from 'vitest'
import { insertLayerAbove, removeLayer } from './layers'
import { createDefaultProject } from './defaults'
import {
  applyFitValues,
  createFitParameter,
  fitParameterName,
  readFitTarget,
  targetIndexOptions,
  transferProjectValuesToStart,
  transferStartValuesToProject,
  writeFitTarget,
} from './fitTargets'
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

describe('applying fit results', () => {
  it('writes only the fitted quantities and keeps other edits', () => {
    const atStart = createDefaultProject()
    const parameter = createFitParameter(atStart, 'thickness', 2, null)
    atStart.fit.parameters = [parameter]
    // During the fit the user changed another layer.
    const edited = structuredClone(atStart)
    edited.sample.layers[5].roughness = 9
    const result = applyFitValues(edited, [parameter], [57])
    expect(result.sample.layers[2].thickness).toBe(57)
    expect(result.fit.parameters[0].value).toBe(57)
    expect(result.sample.layers[5].roughness).toBe(9)
    expect(edited.sample.layers[2].thickness).toBe(60)
  })
})

describe('fit table helpers', () => {
  it('transfers start values to the project and back', () => {
    const project = createDefaultProject()
    project.fit.parameters = [{ ...createFitParameter(project, 'thickness', 2, null), value: 61 }]
    const toProject = transferStartValuesToProject(project)
    expect(toProject.sample.layers[2].thickness).toBe(61)
    const edited = structuredClone(toProject)
    edited.sample.layers[2].thickness = 64
    expect(transferProjectValuesToStart(edited).fit.parameters[0].value).toBe(64)
  })

  it('offers layers top-down as index options', () => {
    const options = targetIndexOptions(createDefaultProject(), 'roughness', 0)
    expect(options[0]).toEqual({ value: 13, label: 'air' })
    expect(options.at(-1)).toEqual({ value: 0, label: 'bulk' })
    expect(targetIndexOptions(createDefaultProject(), 'intensityScale', 0)).toEqual([])
  })
})


describe('layer magnetization fit targets', () => {
  it('reads/writes the indexed layer, preserves global direction and rejects absent indices', () => {
    const project = createDefaultProject()
    project.sample.layers[2].magnetization = { gamma: 31, phi: 47 }
    const global = structuredClone(project.calculation.magnetization.direction)
    const gamma = createFitParameter(project, 'magnetizationGamma', 2, null)
    const phi = createFitParameter(project, 'magnetizationPhi', 2, null)
    expect(gamma.value).toBe(31)
    expect(phi.value).toBe(47)
    expect(fitParameterName(project, gamma)).toBe('magnetization γ (layer 2)')
    expect(targetIndexOptions(project, 'magnetizationPhi', 0)).toContainEqual({ value: 2, label: 'layer 2' })
    const changed = applyFitValues(project, [gamma, phi], [22, 33])
    expect(changed.sample.layers[2].magnetization).toEqual({ gamma: 22, phi: 33 })
    expect(changed.sample.layers[1].magnetization).toEqual(project.sample.layers[1].magnetization)
    expect(changed.calculation.magnetization.direction).toEqual(global)
    for (const index of [null, 99]) {
      expect(readFitTarget(project, { ...gamma, index })).toBeUndefined()
      expect(writeFitTarget(project, { ...phi, index }, 5)).toBe(false)
    }
    expect(project.sample.layers[2].magnetization).toEqual({ gamma: 31, phi: 47 })
  })

  it('retains layer identity and parameter settings through stack edits and value transfers', () => {
    const project = createDefaultProject()
    project.fit.parameters = [
      { ...createFitParameter(project, 'magnetizationGamma', 2, null), value: 24, lowerBound: -180, upperBound: 180, step: 2 },
      { ...createFitParameter(project, 'magnetizationPhi', 3, null), value: 35 },
    ]
    const inserted = insertLayerAbove(project, 1).project
    expect(inserted.fit.parameters.map(parameter => parameter.index)).toEqual([3, 4])
    expect(inserted.fit.parameters[0]).toMatchObject({ value: 24, lowerBound: -180, upperBound: 180, step: 2 })
    const transferred = transferStartValuesToProject(inserted)
    expect(transferred.sample.layers[3].magnetization.gamma).toBe(24)
    expect(transferred.sample.layers[4].magnetization.phi).toBe(35)
    const removed = removeLayer(inserted, 3)
    expect(removed.fit.parameters).toHaveLength(1)
    expect(removed.fit.parameters[0].index).toBe(3)
    expect(removed.fit.parameters[0].target).toBe('magnetizationPhi')
  })
})
