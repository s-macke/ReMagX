import { expect, it, vi } from 'vitest'
import { createDefaultProject } from './defaults'
import { calculateRealCurve, type RealCalculationEngine } from './realCalculation'
import type { PreparedVisnovskyQzRequest } from './visnovskyRequest'

it('keeps skipped automatic matrix rows isotropic despite nonzero magnetic scalars', () => {
  const project = createDefaultProject()
  project.calculation.algorithm = 'matrix'
  project.calculation.automaticOpticalConstants = true
  project.calculation.magnetization.mode = 'add'
  project.calculation.roughnessModel = 'nevot-croce'
  project.sample.multilayer = { enabled: true, pattern: '2*(1)' }
  project.scripts.enabled = false
  project.sample.layers[1].deltaMag = 0.001
  project.sample.layers[1].dielectricTensor = { values: Array(18).fill(0.25), anisotropic: false }
  const before = structuredClone(project)
  const construct = vi.fn(() => ({ values: new Float64Array(18).fill(9), anisotropic: true }))
  const matrix = vi.fn((request: PreparedVisnovskyQzRequest) => new Float64Array(request.qz.length * 2))
  const engine = { dielectricTensor: construct, matrixQz: matrix } as unknown as RealCalculationEngine
  calculateRealCurve(project, [], engine, 'qz', 'monochromatic')
  expect(construct).not.toHaveBeenCalled()
  const rows = matrix.mock.calls[0][0].layers
  expect(rows[1].anisotropic).toBe(0)
  expect(rows[1].values.slice(4)).toEqual(Array(18).fill(0.25))
  expect(rows[2]).toEqual(rows[1])
  expect(project).toEqual(before)

  // Manual preparation deliberately reconstructs tensors from scalar constants.
  project.calculation.automaticOpticalConstants = false
  calculateRealCurve(project, [], engine, 'qz', 'monochromatic')
  expect(construct).toHaveBeenCalled()
  expect(matrix.mock.calls[1][0].layers[1].anisotropic).toBe(1)
})
