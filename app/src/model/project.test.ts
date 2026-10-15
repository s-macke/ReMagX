import { describe, expect, it } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import { validateProject } from './project'
import { wavelengthFromEnergy } from './units'

describe('default project', () => {
  it('is valid against the schema', () => {
    const result = validateProject(createDefaultProject())
    expect(result.ok ? [] : result.issues).toEqual([])
  })

  it('reproduces the legacy default multilayer (substrate first, ambient last)', () => {
    const { layers } = createDefaultProject().sample
    expect(layers).toHaveLength(14)
    expect(layers[0].material).toBe('Cu')
    expect(layers[0].thickness).toBe(0)
    expect(layers[1]).toMatchObject({ material: 'Co', thickness: 10, deltaMag: 5.31087e-5 })
    expect(layers[2]).toMatchObject({ material: 'Cu', thickness: 60 })
    expect(layers[13].opticalTable).toBe('vacuum')
    const total = layers.reduce((sum, layer) => sum + layer.thickness, 0)
    expect(total).toBe(6 * 70)
  })

  it('survives a JSON round trip unchanged', () => {
    const project = createDefaultProject()
    const reloaded = validateProject(JSON.parse(JSON.stringify(project)))
    expect(reloaded.ok && reloaded.project).toEqual(project)
  })
})

describe('validation', () => {
  it('rejects a wrong format marker and reports the path', () => {
    const result = validateProject({ ...createDefaultProject(), format: 'something-else' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.join('\n')).toContain('format')
  })

  it('rejects negative thickness', () => {
    const project = createDefaultProject()
    project.sample.layers[1] = createLayer({ thickness: -1 })
    const result = validateProject(project)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.join('\n')).toContain('sample.layers.1.thickness')
  })

  it('rejects dataset columns of different length', () => {
    const project = createDefaultProject()
    const base = createDefaultProject().experiment.polarization
    project.datasets.push({
      title: 'scan',
      comment: '',
      sourceFile: '',
      energy: 777,
      energyShift: 0,
      angularResolution: 0,
      intensityScale: 1,
      intensityOffset: 0,
      qzShift: 0,
      errorWeight: 1,
      polarization: base,
      active: true,
      columns: { qz: [0.1, 0.2], reflectivity: [0.5] },
    })
    const result = validateProject(project)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.join('\n')).toContain('columns.reflectivity')
  })

  it('rejects non-finite numbers', () => {
    const project = createDefaultProject()
    project.experiment.energy = Number.NaN
    expect(validateProject(project).ok).toBe(false)
  })
})

describe('wavelengthFromEnergy', () => {
  it('converts eV to Å', () => {
    expect(wavelengthFromEnergy(12398.326)).toBeCloseTo(1, 14)
    expect(wavelengthFromEnergy(777.198)).toBeCloseTo(15.95260, 5)
  })
})
