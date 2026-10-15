import { useMemo, useState } from 'react'
import defaultExample from '../test/fixtures/default.all?raw'
import tutorial1 from '../test/fixtures/Tut1.all?raw'
import tutorial2 from '../test/fixtures/Tut2.all?raw'
import tutorial3 from '../test/fixtures/Tut3.all?raw'
import { importAllFile } from './import/allFile'
import { activeDataset, adaptedMeasurement, type MeasuredQuantity } from './model/datasets'
import { createDefaultProject } from './model/defaults'
import { canRemoveLayer } from './model/layers'
import { useAppState, useDispatch } from './state/context'
import { ProjectProvider } from './state/ProjectProvider'
import { useCalculation } from './state/useCalculation'
import { Dialog } from './ui/Dialog'
import { chooseFile, downloadProject, readProjectFile } from './ui/fileActions'
import { ImportReportDialog } from './ui/ImportReportDialog'
import { LayerTable } from './ui/LayerTable'
import { MenuBar, type Menu } from './ui/MenuBar'
import { ModePanel } from './ui/ModePanel'
import { PlotPanel } from './ui/PlotPanel'
import { SidePanel } from './ui/SidePanel'

const examples = [
  { label: 'Example: Co/Cu multilayer (default)', file: 'default.all', content: defaultExample },
  { label: 'Example: Tutorial 1', file: 'Tut1.all', content: tutorial1 },
  { label: 'Example: Tutorial 2 (with data)', file: 'Tut2.all', content: tutorial2 },
  { label: 'Example: Tutorial 3 (with data)', file: 'Tut3.all', content: tutorial3 },
]

function Workspace() {
  const state = useAppState()
  const dispatch = useDispatch()
  const { project, scanKind, displayMode } = state
  const calculation = useCalculation(project, scanKind, displayMode)
  const [error, setError] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)

  const measured = useMemo(() => {
    const dataset = activeDataset(project)
    if (!dataset) return []
    const axis = scanKind === 'energyScan' ? 'energy' : 'qz'
    const quantities: MeasuredQuantity[] =
      displayMode === 'asymmetry' ? ['asymmetry'] : displayMode === 'dichroic' ? ['reflectivityPlus', 'reflectivityMinus'] : ['reflectivity']
    return quantities.flatMap((quantity) => {
      const curve = adaptedMeasurement(dataset, quantity, axis)
      return curve ? [{ label: `measured ${quantity === 'reflectivity' ? 'R' : quantity}`, curve }] : []
    })
  }, [project, scanKind, displayMode])

  const open = async () => {
    const file = await chooseFile('.all,.json')
    if (!file) return
    try {
      const opened = await readProjectFile(file)
      dispatch({ type: 'loadProject', ...opened })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const openExample = (example: (typeof examples)[number]) => {
    try {
      const { project: imported, report } = importAllFile(example.content, example.file)
      dispatch({ type: 'loadProject', project: imported, fileName: example.file.replace('.all', '.json'), report })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New', onSelect: () => dispatch({ type: 'loadProject', project: createDefaultProject(), fileName: 'default.json' }) },
        { label: 'Open… (.all, .json)', onSelect: () => void open() },
        { label: 'Save project (.json)', onSelect: () => downloadProject(project, state.fileName) },
        'separator',
        ...examples.map((example) => ({ label: example.label, onSelect: () => openExample(example) })),
      ],
    },
    {
      label: 'Mode',
      items: (['compound', 'element'] as const).map((mode) => ({
        label: mode === 'compound' ? 'Compound Mode' : 'Element Mode',
        checked: project.sample.mode === mode,
        onSelect: () => dispatch({ type: 'updateProject', update: (p) => ({ ...p, sample: { ...p.sample, mode } }) }),
      })),
    },
    { label: 'Script', items: [{ label: 'Open Script Window (coming soon)', disabled: true }] },
    {
      label: 'Layer',
      items: [
        { label: 'Add Layer', onSelect: () => dispatch({ type: 'insertLayer' }) },
        { label: 'Remove Layer', onSelect: () => dispatch({ type: 'removeLayer' }), disabled: !canRemoveLayer(project, state.selectedLayer) },
      ],
    },
    { label: 'Help', items: [{ label: 'About ReMagX Web', onSelect: () => setAboutOpen(true) }] },
  ]

  return (
    <div className="app">
      <MenuBar menus={menus} title={state.fileName} />
      <main className="workspace">
        <LayerTable />
        <PlotPanel curve={calculation.curve} measured={measured} />
        <aside className="workspace__side">
          <SidePanel />
          <ModePanel />
        </aside>
      </main>
      <footer className="status-bar" role="status">
        <span className={calculation.error ? 'status-bar__error' : undefined}>
          {calculation.error ?? (calculation.busy ? 'Calculating…' : `${project.sample.layers.length - 2} ${project.sample.layers.length === 3 ? 'layer' : 'layers'} · ${project.experiment.energy} eV`)}
        </span>
        <span className="status-bar__mock">Mock calculation, not the real ReMagX engine</span>
      </footer>
      {state.importReport && (
        <ImportReportDialog report={state.importReport} fileName={state.fileName.replace('.json', '.all')} onClose={() => dispatch({ type: 'dismissImportReport' })} />
      )}
      {error && (
        <Dialog title="Could not open the file" onClose={() => setError(null)}>
          <pre className="dialog__pre">{error}</pre>
        </Dialog>
      )}
      {aboutOpen && (
        <Dialog title="About ReMagX Web" onClose={() => setAboutOpen(false)}>
          <p>
            Browser version of ReMagX, a program for simulating and fitting (resonant magnetic) X-ray reflectivity. Project website:{' '}
            <a href="https://remagx.org/" target="_blank" rel="noreferrer">
              remagx.org
            </a>
            .
          </p>
          <p>
            <strong>Early preview:</strong> the user interface is being built first. Calculations use a simplified mock, not the real ReMagX
            engine; do not use the results for analysis.
          </p>
          <p>
            Source code (GPL-3.0):{' '}
            <a href="https://github.com/s-macke/ReMagX" target="_blank" rel="noreferrer">
              github.com/s-macke/ReMagX
            </a>
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ProjectProvider>
      <Workspace />
    </ProjectProvider>
  )
}
