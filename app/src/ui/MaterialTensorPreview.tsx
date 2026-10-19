import { useEffect, useState } from 'react'
import { tensorComponents, type TensorPreview } from '../model/tensorView'
import { useAppState } from '../state/context'
import { computeService } from '../state/useCalculation'
import { Note } from './form'
import { formatNumber } from './numberFormat'

// Snapshot at dialog opening, as with the other read-only material values.
export function MaterialTensorPreview({ index }: { index: number }) {
  const state = useAppState()
  const [source] = useState(() => ({ project: state.project, tables: state.opticalTables }))
  const [result, setResult] = useState<TensorPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void computeService().dielectricTensor(source.project, { layerIndex: index, tables: source.tables, spectrum: false })
      .then(result => { if (active) setResult(result) })
      .catch((error: Error) => { if (active) setError(error.message) })
    return () => { active = false }
  }, [source, index])
  return <>
    <Note>{result?.engine === 'real' ? 'Real' : 'Mock'} tensor preview at {source.project.experiment.energy} eV. {result?.source === 'stored' ? 'Retained stored dielectric tensor.' : result?.source === 'table' ? (result.engine === 'real' ? 'Native interpolation of the imported .e table.' : 'Linear interpolation of the imported .e table.') : 'Constructed from the current scalar optical values.'} BeforeCalculation is not executed.</Note>
    {error ? <p role="alert">{error}</p> : !result ? <p>Loading tensor… <button type="button" onClick={() => computeService().stop()}>Stop calculation</button></p> : (['re', 'im'] as const).map(part => <table key={part} className="small-table tensor-preview">
      <caption>{part === 're' ? 'Real part' : 'Imaginary part'}</caption>
      <tbody>{[0, 1, 2].map(row => <tr key={row}>{[0, 1, 2].map(column => {
        const index = row * 3 + column
        return <td key={column}><label>ε_{tensorComponents[index]}<input className="text-input" readOnly aria-label={`ε_${tensorComponents[index]} ${part === 're' ? 'real' : 'imaginary'}`} value={formatNumber(result.tensors[0][index][part])} /></label></td>
      })}</tr>)}</tbody>
    </table>)}
  </>
}
