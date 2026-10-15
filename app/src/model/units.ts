// Physical constants and unit conversions (energies in eV, lengths in Å).

// hc in eV·Å as used by the legacy ReMagX program (CODATA: 12398.41984). Kept so results stay
// comparable with legacy output (decisions F-34, D-29: no deviation from legacy physics).
export const HC_EV_ANGSTROM = 12398.326

// Photon wavelength in Å for an energy in eV.
export function wavelengthFromEnergy(energy: number): number {
  return HC_EV_ANGSTROM / energy
}
