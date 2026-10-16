import { useState } from 'react'
import { applyMaterialSettings, readMaterialSettings } from '../model/materialSettings'
import { useAppState, useDispatch } from '../state/context'
import { MaterialTensorPreview } from './MaterialTensorPreview'
import { Dialog } from './Dialog'
import { CheckboxField, Field, Group } from './form'
import { formatNumber } from './numberFormat'

export function MaterialSettingsDialog({ index, onClose }: { index: number; onClose: () => void }) {
  const { project } = useAppState()
  const dispatch = useDispatch()
  const [initial] = useState(() => readMaterialSettings(project, index)!)
  const [layer] = useState(() => project.sample.layers[index])
  const [draft, setDraft] = useState(() => ({ ...initial, density: String(initial.density), gamma: String(initial.gamma), phi: String(initial.phi) }))
  const [error, setError] = useState<string | null>(null)
  const readonly = (label: string, value: string | number) => <Field label={label}><input className="text-input" readOnly aria-label={label} value={typeof value === 'number' ? formatNumber(value) : value} /></Field>
  const number = (field: 'density' | 'gamma' | 'phi', label: string, unit: string) => <Field label={label} unit={unit}>
    <input className="text-input" type="number" step="any" required min={field === 'density' ? 0 : undefined} aria-label={label} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} />
  </Field>
  return <Dialog title="Material Settings" onClose={onClose} actions={<>
    <button type="submit" form="material-settings-form">OK</button>
    <button type="button" onClick={onClose}>Cancel</button>
  </>}>
    <form id="material-settings-form" onSubmit={event => {
      event.preventDefault()
      try {
        const settings = { ...draft, density: Number(draft.density), gamma: Number(draft.gamma), phi: Number(draft.phi) }
        // Validate synchronously, then merge the draft into the latest reducer state.
        applyMaterialSettings(project, index, initial, settings)
        dispatch({ type: 'updateProject', update: latest => applyMaterialSettings(latest, index, initial, settings) })
        onClose()
      } catch (failure) { setError((failure as Error).message) }
    }}>
      <div className="material-settings-grid">
        <Group title="Structural Parameters">
          {readonly('Name', layer.opticalTable)}
          {readonly('Thickness', layer.thickness)}
          {readonly('Roughness', layer.roughness)}
        </Group>
        <Group title="Compound">
          <Field label="Chemical Formula"><input className="text-input" aria-label="Chemical Formula" value={draft.formula} onChange={event => setDraft({ ...draft, formula: event.target.value })} /></Field>
          {number('density', 'Density', 'g/cm³')}
        </Group>
        <Group title="Optical Constants">
          {readonly('δ', layer.delta)}
          {readonly('β', layer.beta)}
        </Group>
        <Group title="Magneto Optical constants">
          {readonly('δm', layer.deltaMag)}
          {readonly('βm', layer.betaMag)}
          {number('gamma', 'Gamma', '°')}
          <CheckboxField label="Fit Gamma" checked={draft.fitGamma} onChange={fitGamma => setDraft({ ...draft, fitGamma })} />
          {number('phi', 'Phi', '°')}
          <CheckboxField label="Fit Phi" checked={draft.fitPhi} onChange={fitPhi => setDraft({ ...draft, fitPhi })} />
        </Group>
      </div>
      <Group title="Initial Dielectric Tensor">
        <MaterialTensorPreview index={index} />
      </Group>
      {error && <p role="alert">{error}</p>}
    </form>
  </Dialog>
}
