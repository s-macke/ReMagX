// Presets offered by the legacy Polarization and Magneto-Optics frames.

import type { Polarization } from './project'

type Beam = Polarization['beam1']

export type BeamPreset = 'sigma' | 'pi' | 'left-circular' | 'right-circular'

export const beamPresetLabels: Record<BeamPreset, string> = {
  sigma: 'sigma',
  pi: 'pi',
  'left-circular': 'left circular',
  'right-circular': 'right circular',
}

const a = Math.SQRT1_2
const beamPresets: Record<BeamPreset, Beam> = {
  sigma: { sigma: { re: 1, im: 0 }, pi: { re: 0, im: 0 } },
  pi: { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } },
  'left-circular': { sigma: { re: a, im: 0 }, pi: { re: 0, im: a } },
  'right-circular': { sigma: { re: a, im: 0 }, pi: { re: 0, im: -a } },
}

export function beamFromPreset(preset: BeamPreset): Beam {
  return structuredClone(beamPresets[preset])
}

export function presetOfBeam(beam: Beam): BeamPreset | null {
  const close = (x: number, y: number) => Math.abs(x - y) < 1e-6
  for (const [name, p] of Object.entries(beamPresets) as [BeamPreset, Beam][]) {
    if (
      close(beam.sigma.re, p.sigma.re) &&
      close(beam.sigma.im, p.sigma.im) &&
      close(beam.pi.re, p.pi.re) &&
      close(beam.pi.im, p.pi.im)
    ) {
      return name
    }
  }
  return null
}

// Scales the Jones vector to unit intensity (legacy "Norm" button); a zero vector stays zero.
export function normalizeBeam(beam: Beam): Beam {
  const norm = Math.hypot(beam.sigma.re, beam.sigma.im, beam.pi.re, beam.pi.im)
  if (norm === 0) return beam
  return {
    sigma: { re: beam.sigma.re / norm, im: beam.sigma.im / norm },
    pi: { re: beam.pi.re / norm, im: beam.pi.im / norm },
  }
}

export type MagnetizationPreset = 'in-plane-y' | 'in-plane-x' | 'out-of-plane'

export const magnetizationPresets: Record<MagnetizationPreset, { label: string; gamma: number; phi: number }> = {
  'in-plane-y': { label: 'in-plane parallel to y', gamma: 90, phi: 90 },
  'in-plane-x': { label: 'in-plane parallel to x', gamma: 0, phi: 90 },
  'out-of-plane': { label: 'out-of-plane', gamma: 0, phi: 0 },
}
