import { useState } from 'react'
import { formatNumber, parseNumber } from './numberFormat'

interface NumberCellProps {
  value: number
  onCommit: (value: number) => void
  label: string
  min?: number
}

// Editable number: commits on Enter or blur, Escape restores the stored value, invalid input is
// marked and not committed.
export function NumberCell({ value, onCommit, label, min }: NumberCellProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = draft === null ? value : parseNumber(draft)
  const invalid = draft !== null && (parsed === null || (min !== undefined && parsed < min))

  const commit = () => {
    if (draft !== null && !invalid && parsed !== null && parsed !== value) onCommit(parsed)
    setDraft(null)
  }

  return (
    <input
      className={`number-cell${invalid ? ' number-cell--invalid' : ''}`}
      aria-label={label}
      aria-invalid={invalid}
      inputMode="decimal"
      value={draft ?? formatNumber(value)}
      onFocus={(event) => event.currentTarget.select()}
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
