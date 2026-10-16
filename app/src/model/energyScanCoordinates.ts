import type { OpticalTable } from '../import/tables'
import type { Project } from './project'
import { HC_EV_ANGSTROM } from './units'

// Unit1.cpp Button24Click and MaterialConstantsHelper.cpp GetMaximumEnergyRange.
// Button3Click and Button24Click both read EScanFrame CheckBox5 (usemeasurementqz).
export function prepareEnergyCoordinates(project: Project, tables: OpticalTable[]): { energy: number[]; qz: number[] } {
  if (project.experiment.qzScan.useDatasetPoints) {
    const dataset = project.activeDatasetIndex === null ? undefined : project.datasets[project.activeDatasetIndex]
    if (!dataset?.columns.energy?.length || dataset.columns.energy.length !== dataset.columns.qz.length) {
      throw new Error('Energy dataset calculation needs matching nonempty energy and qz columns.')
    }
    const energyShift = Math.abs(dataset.energyShift) > 1e-10 ? dataset.energyShift : 0
    const qzShift = Math.abs(dataset.qzShift) > 1e-10 ? dataset.qzShift : 0
    const energy = dataset.columns.energy.map(value => value + energyShift)
    const qz = dataset.columns.qz.map(value => value + qzShift)
    if (!energy.every(value => Number.isFinite(value) && value > 0) || !qz.every(Number.isFinite)) {
      throw new Error('Energy dataset coordinates must be finite, with positive energies.')
    }
    return { energy, qz }
  }
  if (project.sample.mode !== 'compound') throw new Error('Real element-mode energy scan preparation is not implemented yet.')
  const scan = project.experiment.energyScan
  let minimum = scan.energyMin
  let maximum = scan.energyMax
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) throw new Error('Energy scan bounds must be finite.')
  for (const layer of project.sample.layers) {
    const name = layer.opticalTable
    const primary = tables.find(table => name && table.name === name && table.kind === 'db')
    if (!primary?.energy.length) throw new Error(`Missing optical table ${name || '(unnamed)'}.db for energy scan.`)
    const magnetic = project.calculation.magnetization.mode !== 'none'
      ? tables.find(table => table.name === name && table.kind === 'm') : undefined
    for (const table of [primary, magnetic]) if (table?.energy.length) {
      minimum = Math.max(minimum, table.energy[0])
      maximum = Math.min(maximum, table.energy.at(-1)!)
    }
  }
  const points = project.experiment.qzScan.points // legacy shared numberofpoints
  if (!Number.isSafeInteger(points) || points < 2 || points > 1000000) throw new Error('An energy scan needs 2 to 1,000,000 intervals.')
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum <= 0 || maximum <= minimum) {
    throw new Error('Energy scan and optical tables need an overlapping positive range with distinct bounds.')
  }
  const step = (maximum - minimum) / points
  if (!Number.isFinite(step) || minimum + step <= minimum) throw new Error('Energy scan step is too small to advance.')
  const energy: number[] = []
  const qz: number[] = []
  // Repeated addition is deliberate: the legacy endpoint count depends on rounding.
  for (let current = minimum; current <= maximum; current += step) {
    if (energy.length >= 1000002 || current + step <= current) throw new Error('Energy scan exceeds the supported point limit.')
    energy.push(current)
    qz.push(scan.fixed === 'angle'
      ? 2 * (2 * Math.PI / (HC_EV_ANGSTROM / current)) * Math.sin(scan.angle / 180 * Math.PI)
      : scan.qz)
  }
  if (!qz.every(Number.isFinite)) throw new Error('Prepared energy-scan qz values exceed the supported numerical range.')
  return { energy, qz }
}
