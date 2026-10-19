import type { Project } from './project'

/** D-25 retains these project settings for later implementation. Never substitute a solver. */
export function assertRealAlgorithm(algorithm: Project['calculation']['algorithm']): void {
  if (algorithm === 'parratt-single-scattering') {
    throw new Error('Parratt without multiple scattering is planned for a later release and is not available in the real engine.')
  }
  if (algorithm === 'electron-yield') {
    throw new Error('Total electron yield is planned for a later release and is not available in the real engine.')
  }
}
