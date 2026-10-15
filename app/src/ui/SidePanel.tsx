import { useState } from 'react'
import { useAppState } from '../state/context'
import { SectionPanel, type Section } from './SectionPanel'
import { EnergySection, MapSection, PolarizationSection, ResolutionSection, SimulationParametersSection, XAxisSection } from './sections/ExperimentSections'
import {
  AdditionalFitParametersSection,
  FitAlgorithmParametersSection,
  FitAlgorithmSection,
  FitParametersSection,
  FitStartStopSection,
  FitWindowSection,
} from './sections/FitSections'
import {
  DatasetSection,
  ElementModeSection,
  MagnetizationProfileSection,
  MagnetoOpticsSection,
  OpticalConstantsSection,
  SegmentationSection,
} from './sections/SampleSections'

type Tab = 'experiment' | 'sample' | 'fit'

const tabs: { id: Tab; label: string }[] = [
  { id: 'experiment', label: 'Experiment' },
  { id: 'sample', label: 'Sample' },
  { id: 'fit', label: 'Fit' },
]

// Right-hand panel: tabs Experiment / Sample / Fit, each a stack of collapsible sections with
// the legacy section names (client/Unit1.cpp, BoxFrames).
export function SidePanel() {
  const [tab, setTab] = useState<Tab>('sample')
  const { project, fitStatus } = useAppState()

  const sections: Record<Tab, Section[]> = {
    experiment: [
      { id: 'energy', title: 'Const. Energy Settings', content: <EnergySection /> },
      { id: 'x-axis', title: 'X-Axis', content: <XAxisSection /> },
      { id: 'resolution', title: 'Resolution', content: <ResolutionSection /> },
      { id: 'simulation', title: 'Simulation Parameters', content: <SimulationParametersSection /> },
      { id: 'polarization', title: 'Polarization', content: <PolarizationSection /> },
      { id: 'map', title: 'Map Calculations', content: <MapSection /> },
    ],
    sample: [
      { id: 'dataset', title: `Dataset (${project.datasets.length})`, content: <DatasetSection /> },
      { id: 'segmentation', title: 'Adaptive Layer Segmentation', content: <SegmentationSection /> },
      { id: 'optical-constants', title: 'Optical Constants Database', content: <OpticalConstantsSection /> },
      { id: 'element-mode', title: 'Element Mode', content: <ElementModeSection />, hidden: project.sample.mode !== 'element' },
      { id: 'magneto-optics', title: 'Magneto-Optics', content: <MagnetoOpticsSection /> },
      { id: 'magnetization-profile', title: 'Additional Magnetization Profile', content: <MagnetizationProfileSection /> },
    ],
    fit: [
      { id: 'fit-algorithm', title: 'Algorithm', content: <FitAlgorithmSection /> },
      { id: 'fit-additional', title: 'Additional Fit Parameters', content: <AdditionalFitParametersSection /> },
      { id: 'fit-window', title: 'Fitting Window', content: <FitWindowSection /> },
      { id: 'fit-algorithm-parameters', title: 'Algorithm Parameters', content: <FitAlgorithmParametersSection /> },
      { id: 'fit-parameters', title: `Parameters (${project.fit.parameters.length})`, content: <FitParametersSection /> },
      {
        id: 'fit-start-stop',
        title: fitStatus.running ? `Start / Stop — iteration ${fitStatus.iteration}` : 'Start / Stop',
        content: <FitStartStopSection />,
      },
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
