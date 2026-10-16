import createCore from './remagx-core.mjs'
import { calculateParratt, calculateParrattQz, lookupTable, convolveEnergy, calculateParrattEnergyScan, calculateDielectricTensor } from './parratt.mjs'

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
      self.postMessage({ kind: 'results', tensors: (data.tensors ?? []).map(item => { const result = calculateDielectricTensor(core, item); return { values: Array.from(result.values), anisotropic: result.anisotropic } }), scans: (data.scans ?? []).map(item => Array.from(calculateParrattEnergyScan(core, item))), energy: (data.energy ?? []).map(item => Array.from(convolveEnergy(core, item.energy, new Float64Array(item.raw), item.width))), tables: (data.tables ?? []).map(table => { const result = lookupTable(core, table, table.queries, table.cursor); return { values: Array.from(result.values), cursor: result.cursor } }), values: data.cases.map(prepared =>
        Array.from(prepared.kind === 'qz' ? calculateParrattQz(core, prepared) : calculateParratt(core, prepared))) })
    }
  } catch (error) {
    self.postMessage({ kind: 'failure', message: String(error) })
  }
}
self.postMessage({ kind: 'ready' })
