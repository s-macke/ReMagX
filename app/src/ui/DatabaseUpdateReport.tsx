import { useAppState, useDispatch } from '../state/context'
import { Dialog } from './Dialog'
import { Note } from './form'

export function DatabaseUpdateReport() {
  const { databaseUpdate } = useAppState()
  const dispatch = useDispatch()
  if (!databaseUpdate.result && !databaseUpdate.error) return null
  const result = databaseUpdate.result
  return <Dialog title="Database update" onClose={() => dispatch({ type: 'dismissDatabaseUpdate' })}>
    {databaseUpdate.error && <p role="alert">{databaseUpdate.error}</p>}
    {result && <>
      <p>Updated {result.updates.length} {result.mode === 'compound' ? 'layer(s)' : 'element(s)'} at the current energy. {result.updates.length ? 'Undo restores the previous values.' : 'No values changed.'}</p>
      <Note>Mock database update: linear table interpolation. Legacy interpolation, built-in data and tensors are still pending.</Note>
      {result.warnings.length > 0 && <ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    </>}
  </Dialog>
}
