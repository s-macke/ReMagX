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

it('returns one actually evaluated best snapshot for the curve, score and exported parameters', async () => {
  const { fitLorentzianStep, lineFitText } = await import('./lorentzianStep')
  const request = { source: { label: 'measured R', x: [698, 700, 702], y: [.3, 1.3, .5] }, area: { min: 698, max: 702 } }
  const before = structuredClone(request)
  const result = fitLorentzianStep(request, ({ simplex, objective }) => {
    objective(new Float64Array(simplex[0]))
    objective(new Float64Array(simplex[1]))
    // A minimizer's last snapshot is deliberately unrelated to its best evaluation.
    return { parameters: new Float64Array(6).fill(999), value: 999, termination: 'iteration-limit', iterations: 2, evaluations: 2 }
  })
  expect(result.parameters).not.toEqual(Array(6).fill(999))
  expect(result.y).toEqual(result.x.map(x => lorentzianStepValue(x, result.parameters)))
  expect(result.squaredError).toBe(result.y.reduce((sum, y, i) => sum + (y - request.source.y[i]) ** 2, 0))
  expect(lineFitText(result)).toContain(`A = ${result.parameters[0]}`)
  expect(result.termination).toBe('iteration-limit')
  expect(request).toEqual(before)
  expect(() => fitLorentzianStep(request, () => ({ parameters: null, value: null, termination: 'stopped', iterations: 0, evaluations: 0 }))).toThrow('stopped')
})
