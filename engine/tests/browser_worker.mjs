import { checkScattering } from './scattering_checks.mjs'
import { calculateFitError } from './fit_error.mjs'
import { checkFitErrors } from './fit_error_checks.mjs'
import { minimizeSimplex } from './optimizer.mjs'
import { checkOptimizer } from './optimizer_checks.mjs'
import createCore from './remagx-core.mjs'
import { calculateGaussLorentzianReal, calculateGaussLorentzianImag, calculateParratt, calculateParrattQz, lookupTable, convolveFastQz, convolveEnergy, calculateParrattEnergyScan, calculateDielectricTensor, calculateScatteringTensor, calculateVisnovsky, calculateVisnovskyQz, calculateVisnovskyEnergyScan, calculateZak, calculateZakQz, calculateZakEnergyScan, calculateGaussianProfile, generateGaussianSplineKnots, applyGaussianProfiles } from './parratt.mjs'

const core = await createCore()
self.onmessage = ({ data }) => {
  try {
    if (data.kind === 'busy') {
      // Signal immediately before entering a long synchronous call to the actual WASM core.
      const prepared = {
        layers: Array.from({ length: 1000 }, (_, index) =>
          [10, 1, index % 2 ? .001 : .002, .0001, 0, 0, 90, 90]),
        points: Array.from({ length: 100000 }, () => [.1, 1, 0]),
        beam: [1, 0, 0, 0],
      }
      const original = core._remagx_parratt
      core._remagx_parratt = (...args) => {
        self.postMessage({ kind: 'entered' })
        return original(...args)
      }
      calculateParratt(core, prepared)
      self.postMessage({ kind: 'finished' })
    } else {
      self.postMessage({ kind: 'results', scattering: data.scattering ? checkScattering(core, calculateScatteringTensor, data.scattering) : null, lineShapes: (data.lineShapes ?? []).map(item => (item.kind === 'real' ? calculateGaussLorentzianReal : calculateGaussLorentzianImag)(core, item.parameters)), fitErrors: data.fitErrors ? checkFitErrors(core, calculateFitError, data.fitErrors) : null, optimizer: data.optimizer ? checkOptimizer(core, minimizeSimplex, data.optimizer, calculateParratt, calculateFitError) : null, profiles: (data.profiles ?? []).map(item => { if (item.kind === 'application') return Array.from(applyGaussianProfiles(core, item)); if (item.kind === 'gaussian') return Array.from(calculateGaussianProfile(core, item)); const result = generateGaussianSplineKnots(core, item); return [...result.positions, ...result.values] }), zak: (data.zak ?? []).map(item => Array.from(item.kind === 'energy' ? calculateZakEnergyScan(core, item) : item.kind === 'qz' ? calculateZakQz(core, item) : calculateZak(core, item))), matrices: (data.matrices ?? []).map(item => Array.from(item.kind === 'energy' ? calculateVisnovskyEnergyScan(core, item) : item.kind === 'qz' ? calculateVisnovskyQz(core, item) : calculateVisnovsky(core, item))), tensors: (data.tensors ?? []).map(item => { const result = calculateDielectricTensor(core, item); return { values: Array.from(result.values), anisotropic: result.anisotropic } }), scans: (data.scans ?? []).map(item => Array.from(calculateParrattEnergyScan(core, item))), energy: (data.energy ?? []).map(item => Array.from((item.kind === 'fast-qz' ? convolveFastQz : convolveEnergy)(core, item.energy, new Float64Array(item.raw), item.width))), tables: (data.tables ?? []).map(table => { const result = lookupTable(core, table, table.queries, table.cursor); return { values: Array.from(result.values), cursor: result.cursor } }), values: data.cases.map(prepared =>
        Array.from(prepared.kind === 'qz' ? calculateParrattQz(core, prepared) : calculateParratt(core, prepared))) })
    }
  } catch (error) {
    self.postMessage({ kind: 'failure', message: String(error) })
  }
}
self.postMessage({ kind: 'ready' })
