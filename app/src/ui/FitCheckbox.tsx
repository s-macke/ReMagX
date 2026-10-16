import { cellIsFitted, toggleCellFit, type CellFitTarget } from '../model/cellFit'
import { useAppState, useDispatch } from '../state/context'
import { CheckboxField } from './form'

export function FitCheckbox({ label, target }: { label: string; target: CellFitTarget }) {
  const { project } = useAppState()
  const dispatch = useDispatch()
  return <CheckboxField label={label} checked={cellIsFitted(project, target)} onChange={() => dispatch({ type: 'updateProject', update: current => toggleCellFit(current, target) })} />
}
