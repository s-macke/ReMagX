import { useDispatch } from '../state/context'
import { valueCellKey, type ValueCell } from '../model/valueSlider'
import { useEffect, useState } from 'react'
import { formatNumber, parseNumber } from './numberFormat'

interface NumberCellProps {
  value: number
  onCommit: (value: number) => void
  label: string
  sliderTarget?: ValueCell
  min?: number
  disabled?: boolean
}

// Editable number: commits on Enter or blur, Escape restores the stored value, invalid input is
// marked and not committed.
export function NumberCell({ value, onCommit, label, min, sliderTarget, disabled = false }: NumberCellProps) {
  const dispatch = useDispatch()
  const sliderKey = sliderTarget ? valueCellKey(sliderTarget) : null
  useEffect(() => () => { if (sliderKey) dispatch({ type: 'clearValueCell', key: sliderKey }) }, [sliderKey, dispatch])
  const select = () => sliderTarget ? dispatch({ type: 'selectValueCell', target: sliderTarget, label }) : dispatch({ type: 'clearValueCell' })
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = draft === null ? value : parseNumber(draft)
  const invalid = draft !== null && (parsed === null || (min !== undefined && parsed < min))

  const commit = () => {
    if (!disabled && draft !== null && !invalid && parsed !== null && parsed !== value) onCommit(parsed)
    setDraft(null)
  }

  return (
    <input
      className={`number-cell${invalid ? ' number-cell--invalid' : ''}`}
      aria-label={label}
      aria-invalid={invalid}
      inputMode="decimal"
      disabled={disabled}
      value={draft ?? formatNumber(value)}
      onFocus={(event) => { event.currentTarget.select(); select() }}
      onClick={select}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
