import { useState } from 'react'
import { validatePlotProperties, type PlotProperties } from '../model/plotProperties'
import { Dialog } from './Dialog'
import { Field, Group, CheckboxField } from './form'

export function PlotPropertiesDialog({ initial, onApply, onClose }: { initial: PlotProperties; onApply: (properties: PlotProperties) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  return <Dialog title="Plot Properties" onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault()
      const problem = validatePlotProperties(draft)
      setError(problem)
      if (!problem) { onApply(draft); onClose() }
    }}>
      {(['x', 'y'] as const).map(axis => <Group key={axis} title={`${axis.toUpperCase()}-Axis`}>
        {(['min', 'max', 'steps'] as const).map(field => <Field key={field} label={`${axis.toUpperCase()} ${field}`}>
          <input type="number" step={field === 'steps' ? 1 : 'any'} required value={Number.isNaN(draft[axis][field]) ? '' : draft[axis][field]} onChange={event => setDraft({ ...draft, [axis]: { ...draft[axis], [field]: event.target.valueAsNumber } })} />
        </Field>)}
        <CheckboxField label={`${axis.toUpperCase()} logscale`} checked={draft[axis].logarithmic} onChange={logarithmic => setDraft({ ...draft, [axis]: { ...draft[axis], logarithmic } })} />
      </Group>)}
      <Group title="Colors">
        {(['background', 'border'] as const).map(key => <Field key={key} label={key === 'background' ? 'Background' : 'Border'}><input type="color" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></Field>)}
        {draft.colors.map((color, index) => <Field key={index} label={`Pen color ${index + 1}`}><input type="color" value={color} onChange={event => setDraft({ ...draft, colors: draft.colors.map((value, i) => i === index ? event.target.value : value) })} /></Field>)}
      </Group>
      <Field label="Font size"><input type="number" required min={5} max={25} value={Number.isNaN(draft.fontSize) ? '' : draft.fontSize} onChange={event => setDraft({ ...draft, fontSize: event.target.valueAsNumber })} /></Field>
      <Field label="Line width"><input type="number" step="any" required min={1} max={10} value={Number.isNaN(draft.lineWidth) ? '' : draft.lineWidth} onChange={event => setDraft({ ...draft, lineWidth: event.target.valueAsNumber })} /></Field>
      <CheckboxField label="Show points" checked={draft.points} onChange={points => setDraft({ ...draft, points })} />
      {error && <p role="alert">{error}</p>}
      <div className="button-row"><button type="submit">Apply</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  </Dialog>
}
