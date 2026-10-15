import { useId, type ReactNode } from 'react'
import { NumberCell } from './NumberCell'

// Small form controls used by the settings sections, styled like the legacy frames.

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

export function Field({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">
        {children}
        {unit && <span className="field__unit">{unit}</span>}
      </span>
    </label>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  unit?: string
  min?: number
  integer?: boolean
}

export function NumberField({ label, value, onChange, unit, min, integer }: NumberFieldProps) {
  return (
    <Field label={label} unit={unit}>
      <NumberCell label={label} value={value} min={min} onCommit={(v) => onChange(integer ? Math.round(v) : v)} />
    </Field>
  )
}

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  title?: string
}) {
  return (
    <label className={`checkbox${disabled ? ' is-disabled' : ''}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export interface Option<T extends string> {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

export function RadioGroupField<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 1,
}: {
  label: string
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  columns?: number
}) {
  const name = useId()
  return (
    <fieldset className="group radio-group">
      <legend>{label}</legend>
      <div className="radio-group__options" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((option) => (
          <label key={option.value} className={option.disabled ? 'is-disabled' : undefined} title={option.title}>
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
}) {
  return (
    <Field label={label}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="button-row">{children}</div>
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>
}
