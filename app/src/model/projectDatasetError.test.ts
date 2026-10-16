import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import type { Dataset } from './project'
import { calculateProjectDatasetError, type FitErrorRequest } from './projectDatasetError'
import type { RealEngine } from '../compute/realEngine'

function fixture() {
  const project = createDefaultProject()
  project.sample.layers = [createLayer({ opticalTable: 'sample', delta: .01 }), createLayer({ opticalTable: 'sample' })]
  const dataset: Dataset = { title: '', comment: '', sourceFile: '', energy: 640, energyShift: 2, qzShift: .001,
    angularResolution: .002, intensityScale: 2, intensityOffset: 1, active: true, errorWeight: 3,
    polarization: project.experiment.polarization, columns: { qz: [.02, .01], reflectivity: [1, 2] } }
  project.datasets = [dataset]
  const values = (count: number) => new Float64Array(Array.from({ length: count }, () => [3, 1]).flat())
  const engine: RealEngine = {
    calculate: vi.fn(request => values(request.qz.length)), zakQz: vi.fn(request => values(request.qz.length)),
    matrixQz: vi.fn(request => values(request.qz.length)),
    energyScan: vi.fn(request => values(request.energy.length)), zakEnergy: vi.fn(request => values(request.energy.length)),
    matrixEnergy: vi.fn(request => values(request.energy.length)),
    dielectricTensor: vi.fn(() => ({ values: new Float64Array(18), anisotropic: false })),
    lookup: vi.fn(() => ({ values: new Float64Array([.01, .002]), cursor: 0 })),
    fitError: vi.fn((request: FitErrorRequest) => ({ error: request.mode + 1, accepted: request.qz.length })),
  }
  const tables = [{ name: 'sample', kind: 'db' as const, energy: [600, 800], columns: [[.01, .01], [.002, .002]], warnings: [] }]
  return { project, dataset, engine, tables }
}
it('sums all fit-enabled datasets in order, keeping zero/negative weights and ignoring UI selection/Q', () => {
  const { project, dataset, engine } = fixture()
  project.datasets = [dataset, { ...structuredClone(dataset), errorWeight: 0 }, { ...structuredClone(dataset), errorWeight: -1 },
    { ...structuredClone(dataset), active: false, columns: { qz: [] } }]
  project.activeDatasetIndex = 3; project.fit.occamQ = 999
  const before = structuredClone(project)
  expect(calculateProjectDatasetError(project, [], engine)).toBe(2)
  expect(engine.fitError).toHaveBeenCalledTimes(3)
  expect(engine.fitError).toHaveBeenNthCalledWith(1, expect.objectContaining({ measured: [4, 6], calculated: [3, 3],
    qz: [.021, .011], ...project.fit.window }))
  expect(project).toEqual(before)
  project.datasets.forEach(data => { data.active = false })
  expect(calculateProjectDatasetError(project, [], engine)).toBe(0)
  expect(engine.fitError).toHaveBeenCalledTimes(3)
})
it('routes qz/energy monochromatic, asymmetry and paired beams through each real algorithm', () => {
  for (const algorithm of ['parratt', 'matrix', 'zak'] as const) {
    for (const linear of [false, true]) {
      const { project, dataset, engine, tables } = fixture()
      project.calculation.algorithm = algorithm
      project.fit.errorFunction = linear ? 'lin-chi2' : 'log-chi2'
      project.datasets = []
      for (const energyScan of [false, true]) {
        for (const kind of ['reflectivity', 'asymmetry', 'dichroic']) {
          const data = structuredClone(dataset)
          data.columns = { qz: [.02, .01], ...(energyScan ? { energy: [640, 650] } : {}),
            ...(kind === 'reflectivity' ? { reflectivity: [1, 2] } : kind === 'asymmetry' ? { asymmetry: [-.1, .2] }
              : { reflectivityPlus: [1, 2], reflectivityMinus: [3, 4] }) }
          project.datasets.push(data)
        }
      }
      const modes = [Number(linear), 2, 3, 4 + Number(linear), 6, 7]
      expect(calculateProjectDatasetError(project, tables, engine)).toBe(modes.reduce((sum, mode) => sum + 3 * (mode + 1), 0))
      const requests = vi.mocked(engine.fitError).mock.calls.map(([request]) => request)
      expect(requests.map(request => request.mode)).toEqual(modes)
      expect(requests[1]).toMatchObject({ measured: [-.1, .2], calculated: [.5, .5] })
      expect(requests[2]).toMatchObject({ measured: [4, 6], measuredSecond: [8, 10], calculatedSecond: [1, 1] })
      expect(requests[3].energy).toEqual([642, 652])
      expect(algorithm === 'matrix' ? engine.matrixQz : algorithm === 'zak' ? engine.zakQz : engine.calculate).toHaveBeenCalledTimes(3)
      expect(algorithm === 'matrix' ? engine.matrixEnergy : algorithm === 'zak' ? engine.zakEnergy : engine.energyScan).toHaveBeenCalledTimes(3)
    }
  }
})
it('does not silently drop invalid active datasets, failed calculations or overflowing totals', () => {
  const { project, engine, dataset } = fixture()
  dataset.errorWeight = 0; dataset.columns = { qz: [.01], electronYield: [1] }
  expect(() => calculateProjectDatasetError(project, [], engine)).toThrow('supported')
  dataset.columns = { qz: [.01], reflectivity: [1] }; dataset.errorWeight = 2
  vi.mocked(engine.fitError).mockReturnValue({ error: 1e308, accepted: 1 })
  expect(() => calculateProjectDatasetError(project, [], engine)).toThrow('Weighted')
  vi.mocked(engine.fitError).mockReturnValue({ error: 1, accepted: 2 })
  expect(() => calculateProjectDatasetError(project, [], engine)).toThrow('invalid dataset error')
  vi.mocked(engine.calculate).mockImplementation(() => { throw new Error('calculation failed') })
  expect(() => calculateProjectDatasetError(project, [], engine)).toThrow('calculation failed')
})
