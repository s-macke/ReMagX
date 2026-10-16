import { beamFromPreset, beamPresetLabels, normalizeBeam, presetOfBeam, type BeamPreset } from '../model/presets'
import type { Polarization } from '../model/project'
import { ButtonRow, Field, Group } from './form'
import { NumberCell } from './NumberCell'

export function BeamEditor({ title, beam, onChange }: { title: string; beam: Polarization['beam1']; onChange: (beam: Polarization['beam1']) => void }) {
  const preset = presetOfBeam(beam)
  const component = (part: 'sigma' | 'pi', axis: 're' | 'im') => (
    <NumberCell
      label={`${title} ${part} ${axis === 're' ? 'real' : 'imaginary'}`}
      value={beam[part][axis]}
      onCommit={(v) => onChange({ ...beam, [part]: { ...beam[part], [axis]: v } })}
    />
  )
  return (
    <Group title={title}>
      <Field label="preset">
        <select
          className="select"
          value={preset ?? ''}
          onChange={(e) => e.target.value && onChange(beamFromPreset(e.target.value as BeamPreset))}
        >
          <option value="">custom</option>
          {Object.entries(beamPresetLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <table className="jones-table">
        <thead>
          <tr>
            <th />
            <th scope="col">real</th>
            <th scope="col">imaginary</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">sigma</th>
            <td>{component('sigma', 're')}</td>
            <td>{component('sigma', 'im')}</td>
          </tr>
          <tr>
            <th scope="row">pi</th>
            <td>{component('pi', 're')}</td>
            <td>{component('pi', 'im')}</td>
          </tr>
        </tbody>
      </table>
      <ButtonRow>
        <button type="button" onClick={() => onChange(normalizeBeam(beam))}>
          Norm
        </button>
      </ButtonRow>
    </Group>
  )
}

