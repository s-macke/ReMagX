import { describe, expect, it } from 'vitest'
import { createDefaultProject, createLayer } from '../model/defaults'
import { ComputeError } from './ComputeService'
import { calcAsymmetry, calcReflectivity, depthProfile, linspace, parratt, waveNumber, type OpticalLayer } from './mockPhysics'

const ENERGY = 8047.8 // Cu K-alpha
const substrate = (delta: number, beta: number, roughness = 0): OpticalLayer => ({ delta, beta, thickness: 0, roughness })
const vacuum: OpticalLayer = { delta: 0, beta: 0, thickness: 0, roughness: 0 }

describe('parratt (mock)', () => {
  it('matches the analytic Fresnel reflectivity of a bare substrate', () => {
    const delta = 7.6e-6
    const beta = 1.7e-7
    const k0 = waveNumber(ENERGY)
    const qz = linspace(0.005, 0.3, 60)
    const computed = parratt([substrate(delta, beta), vacuum], qz, ENERGY)
    qz.forEach((q, i) => {
      // Independent formula: r = (q - q') / (q + q'), q' = sqrt(q² - 4k0²(2δ - 2iβ - δ² + β² + 2iδβ))
      const kz = q / 2
      // n² - 1 = -2δ + δ² - β² + 2iβ(1 - δ)
      const re = kz * kz + k0 * k0 * (-2 * delta + delta * delta - beta * beta)
      const im = k0 * k0 * 2 * beta * (1 - delta)
      const mod = Math.hypot(re, im)
      const sRe = Math.sqrt((mod + re) / 2)
      const sIm = Math.sqrt((mod - re) / 2)
      const numRe = kz - sRe
      const denRe = kz + sRe
      const expected = (numRe * numRe + sIm * sIm) / (denRe * denRe + sIm * sIm)
      expect(Math.abs(computed[i] - expected) / expected).toBeLessThan(1e-10)
    })
  })

  it('gives total reflection below the critical edge without absorption', () => {
    const delta = 7.6e-6
    const qc = 2 * waveNumber(ENERGY) * Math.sqrt(2 * delta)
    const r = parratt([substrate(delta, 0), vacuum], linspace(0.001, 0.9 * qc, 20), ENERGY)
    r.forEach((value) => expect(value).toBeCloseTo(1, 10))
  })

  // Refraction shortens the spacing near the critical angle; far above it the period is 2π/d.
  it('shows Kiessig fringes with period 2π/d far above the critical angle', () => {
    const d = 200
    const layers = [substrate(7.6e-6, 1.7e-7), { delta: 1.5e-5, beta: 1e-6, thickness: d, roughness: 0 }, vacuum]
    const qz = linspace(0.35, 0.6, 8000)
    const r = parratt(layers, qz, ENERGY)
    const minima = qz.filter((_, i) => i > 0 && i < r.length - 1 && r[i] < r[i - 1] && r[i] < r[i + 1])
    const spacings = minima.slice(1).map((q, i) => q - minima[i])
    const mean = spacings.reduce((a, b) => a + b, 0) / spacings.length
    expect(mean).toBeCloseTo((2 * Math.PI) / d, 3)
  })

  it('reduces high-qz reflectivity with interface roughness', () => {
    const qz = [0.2]
    const smooth = parratt([substrate(7.6e-6, 1.7e-7, 0), vacuum], qz, ENERGY)[0]
    const rough = parratt([substrate(7.6e-6, 1.7e-7, 5), vacuum], qz, ENERGY)[0]
    expect(rough).toBeLessThan(smooth * 0.5)
  })

  it('rejects qz beyond 90° with a readable error', () => {
    expect(() => parratt([substrate(1e-5, 0), vacuum], [10], 700)).toThrow(ComputeError)
    expect(() => parratt([substrate(1e-5, 0), vacuum], [10], 700)).toThrow(/above 90°/)
  })
})

describe('project-level calculations', () => {
  it('computes the default multilayer on the configured grid', () => {
    const project = createDefaultProject()
    const { qz, reflectivity } = calcReflectivity(project)
    expect(qz).toHaveLength(300)
    expect(reflectivity.every((r) => r >= 0 && r <= 1 + 1e-12)).toBe(true)
  })

  it('changes the curve when a thickness changes', () => {
    const project = createDefaultProject()
    const before = calcReflectivity(project).reflectivity
    project.sample.layers[2].thickness = 55
    const after = calcReflectivity(project).reflectivity
    expect(after).not.toEqual(before)
  })

  it('gives zero asymmetry without magnetic contrast', () => {
    const project = createDefaultProject()
    project.sample.layers.forEach((layer) => {
      layer.deltaMag = 0
      layer.betaMag = 0
    })
    calcAsymmetry(project).asymmetry.forEach((a) => expect(Math.abs(a)).toBeLessThan(1e-12))
  })

  it('builds a depth profile from substrate to ambient', () => {
    const project = createDefaultProject()
    const profile = depthProfile(project)
    expect(profile.delta[0]).toBeCloseTo(0.00165, 6) // Cu substrate
    expect(profile.delta.at(-1)).toBeCloseTo(0, 6) // vacuum
  })

  it('rejects element mode in the mock', () => {
    const project = createDefaultProject()
    project.sample.mode = 'element'
    expect(() => calcReflectivity(project)).toThrow(/Element mode/)
  })

  it('handles a two-layer stack', () => {
    const project = createDefaultProject()
    project.sample.layers = [createLayer({ delta: 1e-3, beta: 1e-4 }), createLayer()]
    expect(calcReflectivity(project).reflectivity[0]).toBeCloseTo(1, 6)
  })
})

