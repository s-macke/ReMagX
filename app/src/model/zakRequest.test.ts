import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { prepareZakQzRequest, calculateZakEnergyScan, type PreparedZakEnergyScan } from './zakRequest'
import type { OpticalTable } from '../import/tables'

it('packs expanded Zak scalar layers and complex beams without matrix settings or mutation', () => {
  const project = createDefaultProject()
  project.calculation.algorithm = 'zak'
  project.calculation.magnetization.mode = 'add'
  project.calculation.tensorContribution = 'tetragonal'
  project.sample.multilayer = { enabled: true, pattern: '2*(1)' }
  project.sample.layers[1].magnetization = { gamma: 45, phi: 70 }
  project.experiment.polarization.beam2 = { sigma: { re: .2, im: -.3 }, pi: { re: .4, im: .1 } }
  const before = structuredClone(project)
  const request = prepareZakQzRequest(project, 'dichroic')
  expect(request.layers).toHaveLength(4)
  expect(request.layers[1]).toEqual(request.layers[2])
  expect(request.layers[1]).not.toBe(request.layers[2])
  expect(request.layers[1].slice(6)).toEqual([45, 70])
  expect(request).toMatchObject({ mode: 1, magnetic: 1, beam2: [.2, -.3, .4, .1] })
  expect(request).not.toHaveProperty('tensor')
  expect(request).not.toHaveProperty('epsilon')
  expect(project).toEqual(before)
  project.calculation.magnetization.mode = 'none'
  expect(prepareZakQzRequest(project, 'monochromatic')).toMatchObject({ mode: 0, magnetic: 0, beam2: null })
  project.calculation.magnetization.mode = 'profile'
  expect(prepareZakQzRequest(project, 'monochromatic').magnetic).toBe(1)
  project.calculation.algorithm = 'parratt'
  expect(() => prepareZakQzRequest(project, 'monochromatic')).toThrow('Zak algorithm')
})

it('refreshes scalar energy stacks and full table cursors while discarding tensors for Zak', () => {
  const project = createDefaultProject()
  project.calculation.algorithm = 'zak'
  project.calculation.magnetization.mode = 'add'
  project.sample.layers.forEach(layer => { layer.opticalTable = 'sample' })
  project.experiment.energyScan.energyMin = 100
  project.experiment.energyScan.energyMax = 200
  project.experiment.qzScan.points = 2
  project.experiment.resolution = { ...project.experiment.resolution, angularFwhm: .001, energyFwhm: .5, fastConvolution: true }
  const tables: OpticalTable[] = ['db', 'm', 'e'].map(kind => ({ name: 'sample', kind: kind as OpticalTable['kind'],
    energy: [90, 210], columns: Array.from({ length: kind === 'e' ? 18 : 2 }, () => [0, 1]), warnings: [] }))
  const lookup = vi.fn((table: OpticalTable, energies: number[], cursor: number) => ({
    values: new Float64Array(table.kind === 'e' ? 18 : 2).fill(energies[0] / 10000), cursor: cursor + 1 }))
  const calculate = vi.fn((request: PreparedZakEnergyScan) => new Float64Array(request.energy.flatMap(() => [6, 2])))
  const before = structuredClone(project)
  expect(calculateZakEnergyScan(project, tables, lookup, calculate, 'dichroic').asymmetry).toEqual([.5, .5, .5])
  const request = calculate.mock.calls[0][0]
  expect(request).toMatchObject({ angularWidth: .001, energyWidth: .5, mode: 1, magnetic: 1, enabled: [1, 1, 1] })
  expect(request.stacks.map(stack => stack[0][2])).toEqual([.01, .015, .02])
  expect(request).not.toHaveProperty('dielectricTensors')
  expect(request).not.toHaveProperty('tensor')
  expect(lookup.mock.calls.filter(call => call[0].kind === 'e').map(call => call[2])).toEqual(Array.from({ length: project.sample.layers.length * 3 }, (_, index) => index))
  expect(project).toEqual(before)
  project.calculation.asymmetryDefinition = 'difference'
  expect(calculateZakEnergyScan(project, tables, lookup, calculate, 'dichroic').asymmetry).toEqual([4, 4, 4])
  project.calculation.magnetization.mode = 'profile'
  expect(() => calculateZakEnergyScan(project, tables, lookup, calculate)).not.toThrow()
  project.calculation.roughnessModel = 'segmentation'
  expect(() => calculateZakEnergyScan(project, tables, lookup, calculate)).toThrow('segmentation')
})
