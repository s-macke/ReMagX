import { interpolateTable, type OpticalTable } from '../import/tables'
import type { Project } from '../model/project'
import type { TensorPreview } from '../model/tensorView'
import { ComputeError, type TensorQuery } from './ComputeService'
import { c, mul, scale } from './complex'

// UI-phase preview: linear table interpolation and scalar tensor construction.
// Not a legacy numerical acceptance implementation; no BeforeCalculation execution.
export function mockTensor(project: Project, query: TensorQuery): TensorPreview {
  const layer = project.sample.layers[query.layerIndex]
  if (project.sample.mode !== 'compound' || !layer) throw new ComputeError('Select a compound layer to show its dielectric tensor.')
  const name = layer.opticalTable.replace(/\\/g, '/').split('/').at(-1)!.replace(/\.(db|m|e)$/i, '')
  const table = (kind: OpticalTable['kind']) => query.tables.find(table => table.name === name && table.kind === kind && table.energy.length)
  const tensorTable = table('e')
  const opticalTable = table('db')
  const magneticTable = table('m')
  const grid = tensorTable ?? opticalTable
  if (query.spectrum && !grid) throw new ComputeError(`Load ${name || 'the selected material'}.e or .db to show its tensor spectrum.`)
  const energy = query.spectrum ? [...grid!.energy] : [project.experiment.energy]
  if (energy.some(value => !Number.isFinite(value) || value <= 0)) throw new ComputeError('Tensor energies must be finite and positive.')
  const tensors = energy.map(value => {
    if (tensorTable) {
      const columns = interpolateTable(tensorTable, value)!
      if (columns.length !== 18 || columns.some(value => !Number.isFinite(value))) throw new ComputeError(`The ${name}.e table needs 18 finite tensor columns.`)
      return Array.from({ length: 9 }, (_, index) => c(columns[2 * index], columns[2 * index + 1]))
    }
    const optical = query.spectrum && opticalTable ? interpolateTable(opticalTable, value)! : [layer.delta, layer.beta]
    const magnetic = query.spectrum ? magneticTable ? interpolateTable(magneticTable, value)! : [0, 0] : [layer.deltaMag, layer.betaMag]
    if (optical.length !== 2 || magnetic.length !== 2 || [...optical, ...magnetic].some(value => !Number.isFinite(value))) throw new ComputeError('Invalid optical or magnetic tensor inputs.')
    const diagonal = mul(c(1 - optical[0], optical[1]), c(1 - optical[0], optical[1]))
    const tensor = Array.from({ length: 9 }, (_, index) => index % 4 === 0 ? { ...diagonal } : c(0))
    if (project.calculation.tensorContribution === 'tetragonal') {
      tensor[8] = mul(c(1 - magnetic[0], magnetic[1]), c(1 - magnetic[0], magnetic[1]))
    } else if (project.calculation.magnetization.mode !== 'none') {
      const gamma = layer.magnetization.gamma * Math.PI / 180
      const phi = layer.magnetization.phi * Math.PI / 180
      const amplitude = mul(mul(diagonal, c(magnetic[0], -magnetic[1])), c(0, 2))
      tensor[1] = scale(amplitude, -Math.cos(phi)); tensor[3] = scale(tensor[1], -1)
      tensor[2] = scale(amplitude, Math.sin(gamma) * Math.sin(phi)); tensor[6] = scale(tensor[2], -1)
      tensor[5] = scale(amplitude, Math.cos(gamma) * Math.sin(phi)); tensor[7] = scale(tensor[5], -1)
    }
    if (tensor.some(value => !Number.isFinite(value.re) || !Number.isFinite(value.im))) throw new ComputeError('Tensor values exceed the supported numeric range.')
    return tensor
  })
  return { energy, tensors, source: tensorTable ? 'table' : 'scalar' }
}
