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
