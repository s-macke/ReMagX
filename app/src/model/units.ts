// Physical constants and unit conversions (energies in eV, lengths in Å).

// hc in eV·Å
export const HC_EV_ANGSTROM = 12398.41984332

// Photon wavelength in Å for an energy in eV.
export function wavelengthFromEnergy(energy: number): number {
  return HC_EV_ANGSTROM / energy
}
