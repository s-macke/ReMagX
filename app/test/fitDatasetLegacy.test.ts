// Private-source comparison stays outside the browser TypeScript compilation.
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { createDefaultProject } from '../src/model/defaults'
import type { Dataset } from '../src/model/project'
import { prepareFitDataset } from '../src/model/fitDataset'

function fixture(): Dataset {
  return { title: '', comment: '', sourceFile: '', energy: 640, energyShift: 3,
    qzShift: .01, angularResolution: .002, intensityScale: 2, intensityOffset: .5,
    errorWeight: 4, active: true, polarization: createDefaultProject().experiment.polarization,
    columns: { qz: [.2, .1, .3], reflectivity: [1, 2, 3] } }
}
it.skipIf(!process.env.LEGACY_ROOT)('matches original adaptation and postprocessing on synthetic datasets', () => {
  const cases = Array.from({ length: 96 }, (_, index) => {
    const project = createDefaultProject(); const data = fixture(); project.datasets = [data]
    data.qzShift = index % 3 === 0 ? 1e-10 : -.003
    data.energyShift = index % 3 === 0 ? -1e-10 : 2
    data.intensityScale = (index % 5 - 2) * .7; data.intensityOffset = .01
    data.columns = { qz: [.03, .01, .08, .04], reflectivity: [1, .2, 0, .4],
      reflectivityPlus: [2, .1, .4, .7], reflectivityMinus: [.5, .1, -.4, .9],
      electronYield: [.1, .2, .3, .4] }
    if (index % 2) data.columns.asymmetry = [.9, .8, .7, .6]
    if (index % 3) data.columns.energy = [600, 610, 620, 630]
    if (index % 4 === 0) data.polarization.beam1 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
    if (index % 5 === 0) data.polarization.beam2 = { sigma: { re: 0, im: 0 }, pi: { re: 1, im: 0 } }
    project.calculation.postProcessing.multiplyByQz4 = Boolean(index % 2)
    project.calculation.postProcessing.divideByCos2ThetaSquared = Boolean(index % 3)
    project.calculation.averaging = index % 4
    project.calculation.asymmetryDefinition = index % 3 ? 'normalized' : 'difference'
    return { project, dataset: data, calculation: project.calculation }
  })
  const expected = JSON.parse(execFileSync('python3', ['../tools/golden/legacy/dataset_reference.py'], {
    input: JSON.stringify(cases), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  })) as Dataset['columns'][]
  expect(expected).toHaveLength(cases.length)
  cases.forEach(({ project }, index) => {
    const actual = prepareFitDataset(project, 0).measurement
    for (const [name, values] of Object.entries(expected[index])) {
      const result = actual[name as keyof Dataset['columns']]!
      expect(result).toHaveLength(values!.length)
      values!.forEach((value, point) => expect(Math.abs(result[point] - value)).toBeLessThanOrEqual(1e-15 + 1e-10 * Math.abs(value)))
    }
  })
})
