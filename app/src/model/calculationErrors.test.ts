import { compoundLayerIndices } from './compoundLayers'
import { createDefaultProject } from './defaults'
import { OpticalTableRangeError, refreshCompoundOptics } from './refreshOpticalConstants'
import { expect, it } from 'vitest'
import { calculationErrorMessage, scriptFailure } from './calculationErrors'

it('adds phase-specific guidance while retaining raw Lua source lines and nested failure identity', () => {
  const raw = new Error('BeforeCalculation:3: invalid value\nstack traceback: retained')
  const compile = scriptFailure('compilation', raw)
  expect(compile.message).toBe(raw.message)
  expect(scriptFailure('execution', compile)).toBe(compile)
  expect(calculationErrorMessage(compile)).toContain('Lua script compilation failed.')
  const runtime = scriptFailure('execution', raw)
  expect(calculationErrorMessage(runtime)).toContain('Lua script execution failed.')
  expect(calculationErrorMessage(runtime)).toContain(raw.message)
  expect(calculationErrorMessage(scriptFailure('execution', 'Default:2: failure'))).toContain('Default:2: failure')
})

it('keeps native statuses separate from legacy error numbers and preserves useful domain diagnostics', () => {
  const expected = ['invalid calculation inputs', 'nonfinite numerical result', 'allocate calculation memory', 'Check the qz values and energy']
  expected.forEach((message, index) => expect(calculationErrorMessage({ status: index + 1 })).toContain(message))
  expect(calculationErrorMessage(new Error('Load the missing optical table.'))).toBe('Load the missing optical table.')
  expect(calculationErrorMessage('Multilayer repetition is missing its closing parenthesis.')).toContain('closing parenthesis')
  for (const error of [null, undefined, {}, new Error('  ')]) expect(calculationErrorMessage(error)).toBe('The real engine calculation failed.')
})

it('provides database and multilayer guidance without losing specific causes or range-error identity', () => {
  const project = createDefaultProject()
  project.sample.layers[0].opticalTable = 'required-table'
  let missing: unknown, multilayer: unknown
  try { refreshCompoundOptics(project, [], 640, () => { throw new Error('Unexpected lookup') }) } catch (error) { missing = error }
  expect(calculationErrorMessage(missing)).toContain('Optical database lookup failed.')
  expect(calculationErrorMessage(missing)).toContain('Layer 0: missing optical table required-table.db.')
  const range = new OpticalTableRangeError('Element 0: 640 eV is outside Fe.ff.')
  expect(range).toBeInstanceOf(OpticalTableRangeError)
  expect(calculationErrorMessage(range)).toContain('energy range covers the calculation')
  expect(calculationErrorMessage(range)).toContain(range.message)
  try { compoundLayerIndices(3, '2*(1') } catch (error) { multilayer = error }
  expect(calculationErrorMessage(multilayer)).toContain('Multilayer expansion failed.')
  expect(calculationErrorMessage(multilayer)).toContain('missing its closing parenthesis')
  // Lua callbacks continue receiving raw domain text; only the outer boundary
  // classifies a propagated script error as a script execution failure.
  const nested = scriptFailure('execution', missing)
  expect(nested.message).toBe((missing as Error).message)
  expect(calculationErrorMessage(nested)).toContain('Lua script execution failed.')
})
