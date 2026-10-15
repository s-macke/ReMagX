// Sections of the Sample tab (legacy SampleFrames): DatasetFrame, AdaptiveLayerSegmentationForm,
// OpticalConstantsFrame, ElementFrame, MagnetizationDirectionFrame, MzFrame.

import { useState } from 'react'
import { parseOpticalTable, tableKinds } from '../../import/tables'
import { deleteDataset, moveDataset, updateDataset } from '../../model/datasets'
import { magnetizationPresets, type MagnetizationPreset } from '../../model/presets'
import type { DepthProfileFunction } from '../../model/project'
import { useAppState, useDispatch } from '../../state/context'
import { useEditProject } from '../../state/useEditProject'
import { chooseFiles } from '../fileActions'
import { ButtonRow, CheckboxField, Field, Group, Note, NumberField, RadioGroupField } from '../form'
import { NumberCell } from '../NumberCell'

export function DatasetSection() {
  const { project } = useAppState()
  const dispatch = useDispatch()
  const update = (fn: (p: typeof project) => typeof project) => dispatch({ type: 'updateProject', update: fn })
  const active = project.activeDatasetIndex
  const dataset = active === null ? undefined : project.datasets[active]

  if (project.datasets.length === 0) {
    return <Note>No measured data. Open a legacy .all file that contains datasets (File → Examples → Tutorial 2).</Note>
  }
  return (
    <>
      <ul className="dataset-list" aria-label="Datasets">
        {project.datasets.map((d, index) => (
          <li key={index} className={index === active ? 'is-selected' : undefined}>
            <label className="dataset-list__select">
              <input type="radio" name="active-dataset" checked={index === active} onChange={() => update((p) => ({ ...p, activeDatasetIndex: index }))} />
              <span className="dataset-list__title">{d.title || `dataset ${index + 1}`}</span>
              <span className="dataset-list__meta">
                {d.energy} eV · {d.columns.qz.length} pts
              </span>
            </label>
            <label className="dataset-list__fit" title="Include in fits">
              <input type="checkbox" checked={d.active} onChange={(e) => update((p) => updateDataset(p, index, { active: e.target.checked }))} />
              fit
            </label>
          </li>
        ))}
      </ul>
      {active !== null && (
        <ButtonRow>
          <button type="button" onClick={() => update((p) => moveDataset(p, active, -1))} disabled={active === 0}>
            Up
          </button>
          <button type="button" onClick={() => update((p) => moveDataset(p, active, 1))} disabled={active === project.datasets.length - 1}>
            Down
          </button>
          <button type="button" onClick={() => update((p) => deleteDataset(p, active))}>
            Delete
          </button>
        </ButtonRow>
      )}
      {dataset && active !== null && (
        <Group title="Selected dataset">
          <NumberField label="energy" unit="eV" value={dataset.energy} onChange={(energy) => update((p) => updateDataset(p, active, { energy }))} />
          <NumberField label="intensity scale" value={dataset.intensityScale} onChange={(intensityScale) => update((p) => updateDataset(p, active, { intensityScale }))} />
          <NumberField label="intensity offset" value={dataset.intensityOffset} onChange={(intensityOffset) => update((p) => updateDataset(p, active, { intensityOffset }))} />
          <NumberField label="qz shift" unit="1/Å" value={dataset.qzShift} onChange={(qzShift) => update((p) => updateDataset(p, active, { qzShift }))} />
          <NumberField label="energy shift" unit="eV" value={dataset.energyShift} onChange={(energyShift) => update((p) => updateDataset(p, active, { energyShift }))} />
          <NumberField label="error weight" value={dataset.errorWeight} onChange={(errorWeight) => update((p) => updateDataset(p, active, { errorWeight }))} />
          {dataset.sourceFile && <Note>Source: {dataset.sourceFile}</Note>}
        </Group>
      )}
    </>
  )
}

export function SegmentationSection() {
  const { project } = useAppState()
  const dispatch = useDispatch()
  const edit = useEditProject()
  const s = project.calculation.segmentation
  const active = project.calculation.roughnessModel === 'segmentation'
  return (
    <>
      {!active && <Note>Used when the roughness approximation is set to layer segmentation (Preferences).</Note>}
      <NumberField label="minimal layer thickness" unit="Å" min={0} value={s.minThickness} onChange={(v) => edit((p) => void (p.calculation.segmentation.minThickness = v))} />
      <NumberField label="maximal layer thickness" unit="Å" min={0} value={s.maxThickness} onChange={(v) => edit((p) => void (p.calculation.segmentation.maxThickness = v))} />
      <NumberField label="gradient scale" value={s.gradientScale} onChange={(v) => edit((p) => void (p.calculation.segmentation.gradientScale = v))} />
      <NumberField label="error allowed" min={0} value={s.tolerance} onChange={(v) => edit((p) => void (p.calculation.segmentation.tolerance = v))} />
      <RadioGroupField
        label="model"
        value={s.scope}
        columns={2}
        options={[
          { value: 'global', label: 'global' },
          { value: 'local', label: 'local' },
        ]}
        onChange={(scope) => edit((p) => void (p.calculation.segmentation.scope = scope))}
      />
      <ButtonRow>
        <button type="button" onClick={() => dispatch({ type: 'setPlotView', plotView: 'opticalProfile' })}>
          Show Optical Profile
        </button>
        <button type="button" onClick={() => dispatch({ type: 'setPlotView', plotView: 'magneticProfile' })}>
          Show Magneto-optical Profile
        </button>
      </ButtonRow>
    </>
  )
}

export function OpticalConstantsSection() {
  const { project, opticalTables } = useAppState()
  const dispatch = useDispatch()
  const edit = useEditProject()
  const [warnings, setWarnings] = useState<string[]>([])

  const load = async () => {
    const files = await chooseFiles(Object.keys(tableKinds).map((k) => `.${k}`).join(','))
    const problems: string[] = []
    const tables = []
    for (const file of files) {
      try {
        const table = parseOpticalTable(await file.text(), file.name)
        tables.push(table)
        problems.push(...table.warnings.map((w) => `${file.name}: ${w}`))
      } catch (e) {
        problems.push((e as Error).message)
      }
    }
    if (tables.length > 0) dispatch({ type: 'addOpticalTables', tables })
    setWarnings(problems)
  }

  return (
    <>
      <RadioGroupField
        label="Update optical constants"
        value={project.calculation.automaticOpticalConstants ? 'automatic' : 'manual'}
        options={[
          { value: 'manual', label: 'manual updating' },
          { value: 'automatic', label: 'automatic (ignore manual setting)' },
        ]}
        onChange={(v) => edit((p) => void (p.calculation.automaticOpticalConstants = v === 'automatic'))}
      />
      <Group title="Loaded tables">
        {opticalTables.length === 0 ? (
          <Note>No tables loaded. Load .db, .m, .e, .ff or .ffm files; layers refer to them by name (db column).</Note>
        ) : (
          <table className="small-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Range (eV)</th>
              </tr>
            </thead>
            <tbody>
              {opticalTables.map((t) => (
                <tr key={`${t.name}.${t.kind}`}>
                  <td>{t.name}</td>
                  <td title={tableKinds[t.kind].description}>.{t.kind}</td>
                  <td>{t.energy.length ? `${t.energy[0]} – ${t.energy[t.energy.length - 1]}` : 'empty'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ButtonRow>
          <button type="button" onClick={() => void load()}>
            Load tables…
          </button>
          <button type="button" onClick={() => dispatch({ type: 'clearOpticalTables' })} disabled={opticalTables.length === 0}>
            Delete optical constants cache
          </button>
        </ButtonRow>
        {warnings.length > 0 && (
          <ul className="report-list report-list--warning">
            {warnings.slice(0, 8).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </Group>
      <Note>The mock engine does not use the tables yet; energy scans keep δ and β constant.</Note>
    </>
  )
}

export function ElementModeSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const [index, setIndex] = useState(0)
  const elements = project.sample.elementProfiles
  if (elements.length === 0) return <Note>No elements defined in this project.</Note>
  const current = Math.min(index, elements.length - 1)
  const element = elements[current]
  return (
    <>
      <Group title="Element">
        <div className="pager">
          <button type="button" onClick={() => setIndex(Math.max(0, current - 1))} disabled={current === 0} aria-label="previous element">
            &lt;&lt;
          </button>
          <strong>{element.element || '--'}</strong>
          <span className="pager__count">
            {current + 1} / {elements.length}
          </span>
          <button type="button" onClick={() => setIndex(Math.min(elements.length - 1, current + 1))} disabled={current === elements.length - 1} aria-label="next element">
            &gt;&gt;
          </button>
        </div>
        <NumberField label="f1" value={element.f1} onChange={(v) => edit((p) => void (p.sample.elementProfiles[current].f1 = v))} />
        <NumberField label="f2" value={element.f2} onChange={(v) => edit((p) => void (p.sample.elementProfiles[current].f2 = v))} />
        <NumberField label="f1m" value={element.f1Mag} onChange={(v) => edit((p) => void (p.sample.elementProfiles[current].f1Mag = v))} />
        <NumberField label="f2m" value={element.f2Mag} onChange={(v) => edit((p) => void (p.sample.elementProfiles[current].f2Mag = v))} />
      </Group>
      <table className="small-table">
        <thead>
          <tr>
            <th scope="col">slab</th>
            <th scope="col">thickness (Å)</th>
            <th scope="col">density</th>
            <th scope="col">σ (Å)</th>
          </tr>
        </thead>
        <tbody>
          {element.slabs.map((slab, s) => (
            <tr key={s}>
              <th scope="row">{s}</th>
              <td>
                <NumberCell label={`slab ${s} thickness`} value={slab.thickness} min={0} onCommit={(v) => edit((p) => void (p.sample.elementProfiles[current].slabs[s].thickness = v))} />
              </td>
              <td>
                <NumberCell label={`slab ${s} density`} value={slab.density} min={0} onCommit={(v) => edit((p) => void (p.sample.elementProfiles[current].slabs[s].density = v))} />
              </td>
              <td>
                <NumberCell label={`slab ${s} roughness`} value={slab.roughness} min={0} onCommit={(v) => edit((p) => void (p.sample.elementProfiles[current].slabs[s].roughness = v))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Note>Element mode is not calculated by the mock engine yet.</Note>
    </>
  )
}

export function MagnetoOpticsSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const { mode, direction } = project.calculation.magnetization
  return (
    <>
      <RadioGroupField
        label="Magneto-optics"
        value={mode}
        options={[
          { value: 'none', label: 'no magnetization' },
          { value: 'add', label: 'add magnetization' },
          { value: 'profile', label: 'magnetization with mag. profile' },
        ]}
        onChange={(m) => edit((p) => void (p.calculation.magnetization.mode = m))}
      />
      <Group title="Magnetization direction">
        <NumberField label="gamma" unit="°" value={direction.gamma} onChange={(v) => edit((p) => void (p.calculation.magnetization.direction.gamma = v))} />
        <NumberField label="phi" unit="°" value={direction.phi} onChange={(v) => edit((p) => void (p.calculation.magnetization.direction.phi = v))} />
        <Field label="presets">
          <select
            className="select"
            value=""
            onChange={(e) => {
              const preset = magnetizationPresets[e.target.value as MagnetizationPreset]
              if (preset) edit((p) => void (p.calculation.magnetization.direction = { gamma: preset.gamma, phi: preset.phi }))
            }}
          >
            <option value="">preset…</option>
            {Object.entries(magnetizationPresets).map(([value, preset]) => (
              <option key={value} value={value}>
                {preset.label}
              </option>
            ))}
          </select>
        </Field>
        <ButtonRow>
          <button
            type="button"
            onClick={() =>
              edit((p) => {
                for (const layer of p.sample.layers) layer.magnetization = { ...p.calculation.magnetization.direction }
              })
            }
          >
            Apply to all layers
          </button>
        </ButtonRow>
      </Group>
    </>
  )
}

const newProfileFunction = (): DepthProfileFunction => ({
  deltaAmplitude: 0,
  betaAmplitude: 0,
  center: 0,
  width: 1,
  spline: { enabled: false, points: [] },
  amplitudeCoupledTo: null,
  widthCoupledTo: null,
  boundToLayer: null,
})

export function MagnetizationProfileSection() {
  const { project } = useAppState()
  const edit = useEditProject()
  const [index, setIndex] = useState(0)
  const functions = project.sample.depthProfileFunctions
  const current = Math.min(index, Math.max(0, functions.length - 1))
  const fn = functions[current]

  const couplingSelect = (label: string, value: number | null, onChange: (v: number | null) => void) => (
    <Field label={label}>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">none</option>
        {functions.map((_, i) =>
          i === current ? null : (
            <option key={i} value={i}>
              M{i + 1}
            </option>
          ),
        )}
      </select>
    </Field>
  )

  return (
    <>
      <RadioGroupField
        label="Appending Rule"
        value={project.calculation.profileCombination}
        options={[
          { value: 'sum', label: '+ M1(z) + M2(z) + …' },
          { value: 'product', label: '· (1+M1(z)) · (1+M2(z)) · …' },
        ]}
        onChange={(v) => edit((p) => void (p.calculation.profileCombination = v))}
      />
      <div className="pager">
        <button type="button" onClick={() => setIndex(Math.max(0, current - 1))} disabled={current === 0} aria-label="previous function">
          &lt;&lt;
        </button>
        <strong>{functions.length ? `M${current + 1}` : '--'}</strong>
        <span className="pager__count">{functions.length ? `${current + 1} / ${functions.length}` : 'none'}</span>
        <button type="button" onClick={() => setIndex(Math.min(functions.length - 1, current + 1))} disabled={current >= functions.length - 1} aria-label="next function">
          &gt;&gt;
        </button>
        <button
          type="button"
          onClick={() => {
            edit((p) => void p.sample.depthProfileFunctions.push(newProfileFunction()))
            setIndex(functions.length)
          }}
        >
          Add
        </button>
        <button type="button" disabled={!fn} onClick={() => edit((p) => void p.sample.depthProfileFunctions.splice(current, 1))}>
          Remove
        </button>
      </div>
      {fn && (
        <Group title={fn.spline.enabled ? 'Spline' : 'Gauss'}>
          <NumberField label="δ amplitude" value={fn.deltaAmplitude} onChange={(v) => edit((p) => void (p.sample.depthProfileFunctions[current].deltaAmplitude = v))} />
          <NumberField label="β amplitude" value={fn.betaAmplitude} onChange={(v) => edit((p) => void (p.sample.depthProfileFunctions[current].betaAmplitude = v))} />
          <NumberField label="center z" unit="Å" value={fn.center} onChange={(v) => edit((p) => void (p.sample.depthProfileFunctions[current].center = v))} />
          <NumberField label="width (σ)" unit="Å" min={0} value={fn.width} onChange={(v) => edit((p) => void (p.sample.depthProfileFunctions[current].width = v))} />
          {couplingSelect('amplitude coupled to', fn.amplitudeCoupledTo, (v) => edit((p) => void (p.sample.depthProfileFunctions[current].amplitudeCoupledTo = v)))}
          {couplingSelect('width coupled to', fn.widthCoupledTo, (v) => edit((p) => void (p.sample.depthProfileFunctions[current].widthCoupledTo = v)))}
          <Field label="bound to layer">
            <select
              className="select"
              value={fn.boundToLayer ?? ''}
              onChange={(e) => edit((p) => void (p.sample.depthProfileFunctions[current].boundToLayer = e.target.value === '' ? null : Number(e.target.value)))}
            >
              <option value="">none</option>
              {project.sample.layers.map((_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? 'bulk' : i === project.sample.layers.length - 1 ? 'air' : `layer ${i}`}
                </option>
              ))}
            </select>
          </Field>
          <CheckboxField
            label={`use spline (${fn.spline.points.length} points)`}
            checked={fn.spline.enabled}
            onChange={(v) => edit((p) => void (p.sample.depthProfileFunctions[current].spline.enabled = v))}
          />
        </Group>
      )}
      {project.calculation.magnetization.mode !== 'profile' && <Note>Used with “magnetization with mag. profile” (Magneto-Optics).</Note>}
    </>
  )
}
