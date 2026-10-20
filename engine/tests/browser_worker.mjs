import { checkElementDensity } from './element_density_checks.mjs'
import { checkLayerDensity } from './layer_density_checks.mjs'
import { checkMagneticApplication } from './magnetic_application_checks.mjs'
import { checkSpline } from './spline_checks.mjs'
import { checkFourier } from './fourier_checks.mjs'
import { checkElementOptics } from './element_optics_checks.mjs'
import { checkScattering } from './scattering_checks.mjs'
import { calculateFitError } from './fit_error.mjs'
import { checkFitErrors } from './fit_error_checks.mjs'
import { minimizeSimplex, minimizeAnnealing } from './optimizer.mjs'
import { checkOptimizer } from './optimizer_checks.mjs'
import createCore from './remagx-core.mjs'
import { calculateFourier, calculateGaussLorentzianReal, calculateGaussLorentzianImag, calculateParratt, calculateParrattQz, lookupTable, convolveFastQz, convolveEnergy, calculateParrattEnergyScan, calculateDielectricTensor, calculateScatteringTensor, calculateElementOptics, calculateVisnovsky, calculateVisnovskyQz, calculateVisnovskyEnergyScan, calculateZak, calculateZakQz, calculateZakEnergyScan, calculateGaussianProfile, calculateSplineProfile, generateGaussianSplineKnots, applyGaussianProfiles, applyMagneticProfiles, calculateLayerDensity, calculateElementDensity } from './parratt.mjs'

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
      checkLayerDensity(core, calculateLayerDensity)
      checkElementDensity(core, calculateElementDensity)
      checkSpline(core, calculateSplineProfile)
      checkMagneticApplication(core, applyMagneticProfiles)
      self.postMessage({ kind: 'results', fourier: data.fourier ? checkFourier(core, calculateFourier, data.fourier) : null, elementOptics: data.elementOptics ? checkElementOptics(core, calculateElementOptics, data.elementOptics) : null, scattering: data.scattering ? checkScattering(core, calculateScatteringTensor, data.scattering) : null, lineShapes: (data.lineShapes ?? []).map(item => (item.kind === 'real' ? calculateGaussLorentzianReal : calculateGaussLorentzianImag)(core, item.parameters)), fitErrors: data.fitErrors ? checkFitErrors(core, calculateFitError, data.fitErrors) : null, optimizer: data.optimizer ? checkOptimizer(core, minimizeSimplex, data.optimizer, calculateParratt, calculateFitError, minimizeAnnealing) : null, profiles: (data.profiles ?? []).map(item => { if (item.kind === 'element-density') return Array.from(calculateElementDensity(core, item)); if (item.kind === 'density') return Array.from(calculateLayerDensity(core, item)); if (item.kind === 'mixed-application') return Array.from(applyMagneticProfiles(core, item)); if (item.kind === 'spline') return Array.from(calculateSplineProfile(core, item)); if (item.kind === 'application') return Array.from(applyGaussianProfiles(core, item)); if (item.kind === 'gaussian') return Array.from(calculateGaussianProfile(core, item)); const result = generateGaussianSplineKnots(core, item); return [...result.positions, ...result.values] }), zak: (data.zak ?? []).map(item => Array.from(item.kind === 'energy' ? calculateZakEnergyScan(core, item) : item.kind === 'qz' ? calculateZakQz(core, item) : calculateZak(core, item))), matrices: (data.matrices ?? []).map(item => Array.from(item.kind === 'energy' ? calculateVisnovskyEnergyScan(core, item) : item.kind === 'qz' ? calculateVisnovskyQz(core, item) : calculateVisnovsky(core, item))), tensors: (data.tensors ?? []).map(item => { const result = calculateDielectricTensor(core, item); return { values: Array.from(result.values), anisotropic: result.anisotropic } }), scans: (data.scans ?? []).map(item => Array.from(calculateParrattEnergyScan(core, item))), energy: (data.energy ?? []).map(item => Array.from((item.kind === 'fast-qz' ? convolveFastQz : convolveEnergy)(core, item.energy, new Float64Array(item.raw), item.width))), tables: (data.tables ?? []).map(table => { const result = lookupTable(core, table, table.queries, table.cursor); return { values: Array.from(result.values), cursor: result.cursor } }), values: data.cases.map(prepared =>
        Array.from(prepared.kind === 'qz' ? calculateParrattQz(core, prepared) : calculateParratt(core, prepared))) })
    }
  } catch (error) {
    self.postMessage({ kind: 'failure', message: String(error) })
  }
}
self.postMessage({ kind: 'ready' })
