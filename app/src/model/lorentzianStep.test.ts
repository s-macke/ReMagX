import { expect, it } from 'vitest'
import { lorentzianStepValue, prepareLorentzianStep } from './lorentzianStep'

it('uses the Lorentzian peak area, FWHM, background and tanh half-step at the center', () => {
  const parameters = [Math.PI, 2, 700, .2, .4, 1]
  expect(lorentzianStepValue(700, parameters)).toBeCloseTo(1.4, 14)
  expect(lorentzianStepValue(701, [Math.PI, 2, 700, 0, 0, 1])).toBe(.5)
})
it('preserves legacy seeds and bounds, includes endpoints and refuses undefined ranges', () => {
  const request = { source: { label: 'second', x: [699, 700, 701], y: [.2, 1, .4] }, area: { min: 699, max: 701 } }
  const before = structuredClone(request)
  const prepared = prepareLorentzianStep(request)
  expect(prepared.start).toEqual([8 * .8 / Math.PI, 2, 700, .2, .2, 1])
  expect(prepared.lower).toEqual([0, 0, 699, .2 * .8, -1e99, 0])
  expect(prepared.upper).toEqual([1e99, 1e99, 701, .2 * 1.2, 1e99, 10])
  expect(() => prepareLorentzianStep({ ...request, source: { ...request.source, y: [-.2, 1, .4] } })).toThrow('negative background')
  expect(() => prepareLorentzianStep({ ...request, area: { min: 702, max: 703 } })).toThrow('no samples')
  expect(request).toEqual(before)
})
