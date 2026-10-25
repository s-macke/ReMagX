import { calculateRealCurve } from './realCalculation'
import { summaryText, summaryRange, type SummaryDataset } from './summary'
import { expect, it, vi } from 'vitest'
import { createDefaultProject, createLayer } from './defaults'
import type { Dataset } from './project'
import { calculateProjectDatasetError, evaluateProjectDatasetErrorAsync, evaluateProjectDatasetError, prepareStandaloneDatasetError, type FitErrorRequest } from './projectDatasetError'
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


it('carries partial optical refreshes and dataset context from energy scans into later qz calculations', () => {
  for (const algorithm of ['parratt', 'matrix', 'zak'] as const) {
    const { project, dataset, engine } = fixture()
    project.calculation.algorithm = algorithm
    project.sample.layers[1].opticalTable = 'other'
    project.datasets = [{ ...structuredClone(dataset), errorWeight: 0, energyShift: 0,
      columns: { qz: [.02, .03], energy: [625, 825], reflectivity: [1, 1] } }, dataset]
    project.activeDatasetIndex = 0
    const before = structuredClone(project)
    const tables = [
      { name: 'sample', kind: 'db' as const, energy: [600, 700], columns: [[0, 0], [0, 0]], warnings: [] },
      { name: 'other', kind: 'db' as const, energy: [800, 900], columns: [[0, 0], [0, 0]], warnings: [] },
      { name: 'sample', kind: 'e' as const, energy: [600, 700], columns: Array.from({ length: 18 }, () => [0, 0]), warnings: [] },
    ]
    vi.mocked(engine.lookup).mockImplementation((table, [energy], cursor) => ({
      values: new Float64Array(table.kind === 'e' ? 18 : 2).fill(energy / 100000), cursor: cursor + 1,
    }))
    const result = evaluateProjectDatasetError(project, tables, engine)
    expect(result.project.activeDatasetIndex).toBe(1)
    expect(result.project.experiment.energy).toBe(dataset.energy)
    expect(result.project.sample.layers.map(layer => layer.delta)).toEqual([.00625, .00825])
    expect(result.opticalState?.cursors.size).toBe(3)
    const energyCall = vi.mocked(algorithm === 'matrix' ? engine.matrixEnergy : algorithm === 'zak' ? engine.zakEnergy : engine.energyScan).mock.calls[0][0]
    expect(energyCall.enabled).toEqual([0, 0])
    if (algorithm === 'matrix') {
      const layers = vi.mocked(engine.matrixQz).mock.calls[0][0].layers
      expect(layers[0].values.slice(4)).toEqual(Array(18).fill(.00625))
      expect(layers[0].anisotropic).toBe(1)
      expect(layers[1].values[2]).toBe(1 - .00825)
    } else {
      const layers = vi.mocked(algorithm === 'zak' ? engine.zakQz : engine.calculate).mock.calls[0][0].layers
      expect(layers.map(layer => layer[2])).toEqual([.00625, .00825])
    }
    expect(project).toEqual(before)
    const continued = evaluateProjectDatasetError(result.project, tables, engine, result.opticalState)
    expect(continued.opticalState?.cursors.get(tables[0])).toBe(2)
    expect(result.opticalState?.cursors.get(tables[0])).toBe(1)
    project.datasets.reverse()
    const reversed = evaluateProjectDatasetError(project, tables, engine)
    expect(reversed.project.experiment.energy).toBe(825)
    expect(reversed.project.activeDatasetIndex).toBe(1)
  }
})


it('strictly refreshes standalone chi2 at the GUI energy before dataset preparation and retains cursors', () => {
  const { project, engine, tables } = fixture()
  project.calculation.automaticOpticalConstants = true
  project.experiment.energy = 777.198
  engine.lookup = vi.fn((_table, queries, cursor) => ({ values: new Float64Array([queries[0] / 100000, 0]), cursor: cursor + 1 }))
  const before = structuredClone(project)
  calculateProjectDatasetError(project, tables, engine)
  const energy = 12398.326 / (12398.326 / 777.198)
  expect(vi.mocked(engine.lookup).mock.calls.map(([, queries, cursor]) => [queries[0], cursor])).toEqual([
    [energy, 0], [energy, 1], [energy, 2], [energy, 3], [640, 4], [640, 5],
  ])
  expect(project).toEqual(before)
  project.experiment.energy = 900 // Dataset energy is still valid; GUI preflight must fail first.
  vi.mocked(engine.calculate).mockClear()
  expect(() => calculateProjectDatasetError(project, tables, engine)).toThrow('outside')
  expect(engine.calculate).not.toHaveBeenCalled()
  project.experiment.energy = 640
  expect(() => prepareStandaloneDatasetError(project, [], engine)).toThrow('missing optical table')
  expect(() => prepareStandaloneDatasetError(project, [{ ...tables[0], energy: [] }], engine)).toThrow('missing optical table')
  project.datasets = []
  expect(() => calculateProjectDatasetError(project, [], engine)).toThrow('missing optical table')
  project.calculation.automaticOpticalConstants = false
  expect(calculateProjectDatasetError(project, [], engine)).toBe(0)
})


it.each([false, true])('prepares stored and inactive tensors before chi2 datasets, automatic=%s', automatic => {
  const { project, engine, tables } = fixture()
  project.calculation.automaticOpticalConstants = automatic
  project.experiment.energy = 640
  project.sample.layers[0].dielectricTensor = { values: Array(18).fill(9), anisotropic: true }
  project.sample.elementProfiles = [{ element: 'Fe', f1: 7, f2: 0, f1Mag: 0, f2Mag: 0,
    slabs: [], scatteringTensor: Array(18).fill(8) }]
  engine.scatteringTensor = request => new Float64Array(18).fill(request.factors[0])
  const before = structuredClone(project)
  const prepared = prepareStandaloneDatasetError(project, tables, engine)
  expect(prepared.opticalState.dielectricTensors[0]).toBeNull()
  if (automatic) {
    expect(prepared.opticalState.scatteringTensors![0]).toEqual(new Float64Array(18).fill(8))
    expect(engine.lookup).toHaveBeenCalledTimes(4)
  } else {
    expect(prepared.opticalState.dielectricState![0]!.values).toEqual(new Float64Array(18))
    expect(prepared.opticalState.scatteringTensors![0][0]).toBe(7)
    expect(engine.lookup).not.toHaveBeenCalled()
  }
  expect(project).toEqual(before)
})


it('Summary includes inactive datasets, preserves serial preparation and exports full precision without changing fit scope', async () => {
  const { project, dataset, engine, tables } = fixture()
  const asymmetry = { ...structuredClone(dataset), title: 'inactive energy', active: false, errorWeight: 2,
    columns: { qz: [.01, .02], energy: [640, 650], asymmetry: [-.12345678901234566, .2] } }
  project.datasets = [dataset, asymmetry]
  const before = structuredClone(project)
  const summary: SummaryDataset[] = []
  const initial = prepareStandaloneDatasetError(project, tables, engine)
  const result = await evaluateProjectDatasetErrorAsync(initial.project, engine.fitError,
    async (prepared, previous) => calculateRealCurve(prepared.project, tables, engine, prepared.scan, prepared.beams, previous), initial.opticalState, summary)
  expect(summary).toHaveLength(2)
  expect(summary.map(row => row.weightedError)).toEqual([3, 14])
  expect(result.error).toBe(17)
  expect(summary[1]).toMatchObject({ datasetIndex: 1, scan: 'energy', mode: 'asymmetry', measurement: { energy: [642, 652] } })
  expect(summaryText(summary)).toContain(String(asymmetry.columns.asymmetry[0]))
  expect(summaryText(summary)).toContain('inactive energy')
  expect(summaryRange(summary, 'x', 'energy')).toEqual([642, 652])
  expect(summaryRange(summary, 'x', 'qz')).toEqual([.011, .021])
  expect(project).toEqual(before)
  expect(calculateProjectDatasetError(project, tables, engine)).toBe(3)
  const invalid = structuredClone(project)
  invalid.datasets[1].columns = { qz: [.01], electronYield: [1] }
  await expect(evaluateProjectDatasetErrorAsync(invalid, engine.fitError,
    async (prepared, previous) => calculateRealCurve(prepared.project, tables, engine, prepared.scan, prepared.beams, previous), undefined, [])).rejects.toThrow('Dataset 2: TEY')
})
