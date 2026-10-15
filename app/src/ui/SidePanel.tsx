import { useState, type ReactNode } from 'react'
import type { Project } from '../model/project'
import { useAppState, useDispatch } from '../state/context'
import { NumberCell } from './NumberCell'
import { SectionPanel, type Section } from './SectionPanel'

type Tab = 'experiment' | 'sample' | 'fit'

const tabs: { id: Tab; label: string }[] = [
  { id: 'experiment', label: 'Experiment' },
  { id: 'sample', label: 'Sample' },
  { id: 'fit', label: 'Fit' },
]

const comingNext = <p className="section__placeholder">Settings follow in the next step.</p>

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  )
}

function useProjectUpdate() {
  const dispatch = useDispatch()
  return (update: (project: Project) => Project) => dispatch({ type: 'updateProject', update })
}

function EnergySettings() {
  const { project } = useAppState()
  const update = useProjectUpdate()
  return (
    <Field label="Energy (eV)">
      <NumberCell
        label="energy in eV"
        value={project.experiment.energy}
        min={1e-6}
        onCommit={(energy) => update((p) => ({ ...p, experiment: { ...p.experiment, energy } }))}
      />
    </Field>
  )
}

function XAxisSettings() {
  const { project } = useAppState()
  const update = useProjectUpdate()
  const scan = project.experiment.qzScan
  const set = (patch: Partial<typeof scan>) =>
    update((p) => ({ ...p, experiment: { ...p.experiment, qzScan: { ...p.experiment.qzScan, ...patch } } }))
  return (
    <>
      <Field label="qz min (1/Å)">
        <NumberCell label="qz min" value={scan.qzMin} min={0} onCommit={(qzMin) => set({ qzMin })} />
      </Field>
      <Field label="qz max (1/Å)">
        <NumberCell label="qz max" value={scan.qzMax} min={0} onCommit={(qzMax) => set({ qzMax })} />
      </Field>
      <Field label="number of points">
        <NumberCell label="number of points" value={scan.points} min={2} onCommit={(points) => set({ points: Math.round(points) })} />
      </Field>
    </>
  )
}

function DatasetList() {
  const { project } = useAppState()
  const update = useProjectUpdate()
  if (project.datasets.length === 0) return <p className="section__placeholder">No measured data. Open a legacy .all file that contains datasets.</p>
  return (
    <ul className="dataset-list">
      {project.datasets.map((dataset, index) => (
        <li key={index}>
          <label>
            <input
              type="radio"
              name="active-dataset"
              checked={project.activeDatasetIndex === index}
              onChange={() => update((p) => ({ ...p, activeDatasetIndex: index }))}
            />
            <span className="dataset-list__title">{dataset.title || `dataset ${index + 1}`}</span>
            <span className="dataset-list__meta">
              {dataset.energy} eV · {dataset.columns.qz.length} pts
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}

// Right-hand panel: tabs Experiment / Sample / Fit, each a stack of collapsible sections with
// the legacy section names (client/Unit1.cpp, BoxFrames).
export function SidePanel() {
  const [tab, setTab] = useState<Tab>('sample')
  const { project } = useAppState()
  const evolution = false // the evolution fit is not available yet (D-25)

  const sections: Record<Tab, Section[]> = {
    experiment: [
      { id: 'energy', title: 'Const. Energy Settings', content: <EnergySettings /> },
      { id: 'x-axis', title: 'X-Axis', content: <XAxisSettings /> },
      { id: 'resolution', title: 'Resolution', content: comingNext },
      { id: 'simulation', title: 'Simulation Parameters', content: comingNext },
      { id: 'polarization', title: 'Polarization', content: comingNext },
    ],
    sample: [
      { id: 'dataset', title: `Dataset (${project.datasets.length})`, content: <DatasetList /> },
      { id: 'segmentation', title: 'Adaptive Layer Segmentation', content: comingNext },
      { id: 'optical-constants', title: 'Optical Constants Database', content: comingNext },
      { id: 'element-mode', title: 'Element Mode', content: comingNext, hidden: project.sample.mode !== 'element' },
      { id: 'magneto-optics', title: 'Magneto-Optics', content: comingNext },
      { id: 'magnetization-profile', title: 'Additional Magnetization Profile', content: comingNext },
    ],
    fit: [
      { id: 'fit-algorithm', title: 'Algorithm', content: comingNext },
      { id: 'fit-additional', title: 'Additional Fit Parameters', content: comingNext },
      { id: 'fit-window', title: 'Fitting Window', content: comingNext },
      { id: 'fit-algorithm-parameters', title: 'Algorithm Parameters', content: comingNext, hidden: evolution },
      { id: 'fit-parameters', title: `Parameters (${project.fit.parameters.length})`, content: comingNext },
      { id: 'fit-start-stop', title: 'Start / Stop', content: comingNext, hidden: evolution },
    ],
  }

  return (
    <section className="side-panel" aria-label="Settings">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            className="tabs__tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="side-panel__body" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <SectionPanel sections={sections[tab]} />
      </div>
    </section>
  )
}
