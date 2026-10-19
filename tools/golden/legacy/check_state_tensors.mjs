// Numeric private snapshots arrive on stdin and never enter diagnostics/artifacts.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { calculateDielectricTensor, calculateScatteringTensor } from '../../../engine/wasm/parratt.mjs'
try {
  const cases = JSON.parse(readFileSync(0, 'utf8'))
  if (!Array.isArray(cases) || !cases.length) throw new Error()
  const { default: createModule } = await import(pathToFileURL(resolve(process.argv[2])).href)
  const module = await createModule({ print: () => {}, printErr: () => {} })
  let components = 0
  const compare = (values, expected) => {
    if (values.length !== 18 || expected.length !== 18) throw new Error()
    values.forEach((value, index) => {
      const reference = expected[index]
      if (!Number.isFinite(value) || !Number.isFinite(reference) || Math.abs(value - reference) > 1e-15 + 1e-10 * Math.abs(reference)) throw new Error()
      components++
    })
  }
  for (const item of cases) {
    for (const layer of item.layers) {
      const actual = calculateDielectricTensor(module, { layer: layer.values, tensor: item.tensor, magnetic: item.magnetic })
      if (actual.anisotropic !== layer.expected.anisotropic) throw new Error()
      compare(actual.values, layer.expected.values)
    }
    for (const element of item.elements) {
      compare(calculateScatteringTensor(module, { factors: element.factors, gamma: item.gamma, phi: item.phi,
        tensor: item.tensor, magnetic: item.magnetic }), element.expected)
    }
  }
  if (!components) throw new Error()
  process.stdout.write(JSON.stringify({ projects: cases.length, components }))
} catch {
  process.stderr.write('Original loaded-state tensor comparison failed; private diagnostics withheld.\n')
  process.exitCode = 1
}
