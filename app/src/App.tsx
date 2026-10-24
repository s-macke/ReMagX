import { fitPreviewCurve } from './model/fitPreview'
import { useMaterialLibrary } from './state/useMaterialLibrary'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import defaultExample from '../test/fixtures/default.all?raw'
import tutorial1 from '../test/fixtures/Tut1.all?raw'
import tutorial2 from '../test/fixtures/Tut2.all?raw'
import tutorial3 from '../test/fixtures/Tut3.all?raw'
import { importAllFile } from './import/allFile'
import { plotCoordinates } from './model/plotCoordinates'
import { measuredSeries } from './model/datasets'
import { createDefaultProject } from './model/defaults'
import { canRemoveSlab } from './model/elements'
import { applyFitValues } from './model/fitTargets'
import { canRemoveLayer } from './model/layers'
import { useAppState, useDispatch } from './state/context'
import { ProjectProvider } from './state/ProjectProvider'
import { useScriptExecution } from './state/useScriptExecution'
import type { ScriptTab } from './ui/ScriptWindow'
import { useCalculation } from './state/useCalculation'
import { usePersistence } from './state/usePersistence'
import { Dialog } from './ui/Dialog'
import { chooseFile, downloadText, forgetCurrentFile, openProjectInteractive, saveProjectToFile } from './ui/fileActions'
import { AsciiImportDialog } from './ui/AsciiImportDialog'
import { diagramSeries, layerTableToText, seriesToText } from './import/asciiData'
import { ImportReportDialog } from './ui/ImportReportDialog'
import { ValueSlider } from './ui/ValueSlider'
import { LayerTable } from './ui/LayerTable'
import { MenuBar, type Menu } from './ui/MenuBar'
import { ModePanel } from './ui/ModePanel'
import { PlotPanel } from './ui/PlotPanel'
import { DatabaseUpdateReport } from './ui/DatabaseUpdateReport'
import { MaterialSettingsDialog } from './ui/MaterialSettingsDialog'
import { PreferencesDialog } from './ui/PreferencesDialog'
import { SidePanel } from './ui/SidePanel'
import { Toolbar } from './ui/Toolbar'

// The script window pulls in the code editor; load it only when opened.
const ScriptWindow = lazy(() => import('./ui/ScriptWindow').then((m) => ({ default: m.ScriptWindow })))

// Items of the legacy Tools → Scratch menu (deferred, D-25).
const legacyScratchTools = [
  'Get optical constants from chemical formula in compound mode',
  'Calculate reflectivity and save minima, maxima and refl',
  'Remove spikes from measurement',
  'Fill Tensors',
  'Determine Errors of Chemical Profile',
  'Calculate asymmetry of datasets if Rp and Rm are given',
  'Set all intensity scalings to current',
  'Set error weights for energy-scans by integration',
  'Sort Datasets',
]

const examples = [
  { label: 'Example: Co/Cu multilayer (default)', file: 'default.all', content: defaultExample },
  { label: 'Example: Tutorial 1', file: 'Tut1.all', content: tutorial1 },
  { label: 'Example: Tutorial 2 (with data)', file: 'Tut2.all', content: tutorial2 },
  { label: 'Example: Tutorial 3 (with data)', file: 'Tut3.all', content: tutorial3 },
]

function Workspace() {
  const state = useAppState()
  const [materialDialog, setMaterialDialog] = useState<{ index: number; epoch: number } | null>(null)
  const dispatch = useDispatch()
  const { project, scanKind, displayMode, plotView, fitStatus } = state
  const workerFit = fitStatus.running && fitStatus.workerPreviews === true
  // While a fit runs, the plot follows its current best parameters (legacy live redraw).
  const displayedProject = useMemo(
    () => (!workerFit && fitStatus.running && fitStatus.parameters && fitStatus.values ? applyFitValues(project, fitStatus.parameters, fitStatus.values) : project),
    [project, workerFit, fitStatus.running, fitStatus.parameters, fitStatus.values],
  )
  const reportScriptMessages = useCallback((lines: string[]) => dispatch({ type: 'appendDebug', lines }), [dispatch])
  const backgroundCalculation = useCalculation(displayedProject, { scanKind, displayMode, plotView, illustrateSegmentation: state.illustrateSegmentation, layerIndex: state.selectedLayer, elementIndex: state.selectedElement, tables: state.opticalTables }, state.calculationPaused || workerFit, state.valueSlider !== null, reportScriptMessages)
  const liveCurve = useMemo(() => plotView === 'scan'
    ? fitPreviewCurve(fitStatus.datasetPreview, project.activeDatasetIndex, scanKind === 'energyScan' ? 'energy' : 'qz', displayMode)
    : null, [fitStatus.datasetPreview, project.activeDatasetIndex, scanKind, displayMode, plotView])
  const calculation = workerFit ? { ...backgroundCalculation, curve: liveCurve, busy: true, stopped: false, error: null } : backgroundCalculation
  usePersistence()
  useMaterialLibrary()
  const unsaved = project !== state.savedProject
  const [error, setError] = useState<string | null>(null)
  const [calculationErrorDetails, setCalculationErrorDetails] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [licenseOpen, setLicenseOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [scriptOpen, setScriptOpen] = useState(false)
  const [scriptTab, setScriptTab] = useState<ScriptTab>('beforeCalculation')
  const scriptExecution = useScriptExecution()
  const executeScript = (tab: ScriptTab) => {
    setScriptTab(tab)
    setScriptOpen(true)
    scriptExecution.execute(tab === 'default' ? 'Default' : 'BeforeCalculation')
  }
  const closeScript = () => {
    scriptExecution.stop()
    setScriptOpen(false)
  }
  const [asciiFile, setAsciiFile] = useState<{ name: string; text: string } | null>(null)

  const importDatasets = async () => {
    const file = await chooseFile('.dat,.txt,.csv,.asc,*')
    if (file) setAsciiFile({ name: file.name, text: await file.text() })
  }


  const measured = useMemo(
    () => (plotView === 'scan' ? measuredSeries(project, displayMode, scanKind === 'energyScan' ? 'energy' : 'qz') : []),
    [project, scanKind, displayMode, plotView],
  )

  const plot = useMemo(() => plotCoordinates(calculation.curve, measured, project.experiment.qzScan.showAngle, project.experiment.energy), [calculation.curve, measured, project.experiment.qzScan.showAngle, project.experiment.energy])
  const calculationError = plot.error ?? calculation.error
  if (calculationErrorDetails !== null && calculationErrorDetails !== calculationError) setCalculationErrorDetails(null)

  const baseName = state.fileName.replace(/\.json$/i, '')
  const saveDiagramData = () => {
    const curve = plot.curve
    if (!curve) return
    const xLabel = curve.axis === 'angle' ? 'theta (degrees)' : curve.axis === 'qz' ? 'qz (1/A)' : curve.axis === 'energy' ? 'energy (eV)' : curve.axis === 'depth' ? 'Fourier depth (A)' : 'z (A)'
    downloadText(`${baseName}-diagram.txt`, seriesToText(xLabel, diagramSeries(curve, plot.measured)))
  }

  const open = async () => {
    try {
      const opened = await openProjectInteractive()
      if (opened) dispatch({ type: 'loadProject', ...opened, unsaved: opened.report !== undefined })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const save = async (saveAs: boolean) => {
    try {
      const savedAs = await saveProjectToFile(project, state.fileName, saveAs)
      if (savedAs) dispatch({ type: 'markSaved', fileName: savedAs })
    } catch (e) {
      setError(`Saving failed: ${(e as Error).message}`)
    }
  }

  const newProject = () => {
    forgetCurrentFile()
    dispatch({ type: 'loadProject', project: createDefaultProject(), fileName: 'untitled.json' })
  }

  // Keyboard shortcuts of the File menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      // Text fields and the script editor keep their own undo.
      const target = event.target as HTMLElement | null
      const editingText = !!target && (target.matches('input, textarea, select') || target.isContentEditable)
      if ((key === 'z' || key === 'y') && !editingText) {
        event.preventDefault()
        dispatch({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' })
      } else if (key === 's') {
        event.preventDefault()
        void save(event.shiftKey)
      } else if (key === 'o') {
        event.preventDefault()
        void open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const openExample = (example: (typeof examples)[number]) => {
    try {
      const { project: imported, report } = importAllFile(example.content, example.file)
      forgetCurrentFile()
      dispatch({ type: 'loadProject', project: imported, fileName: example.file.replace('.all', '.json'), report, unsaved: true })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New', onSelect: newProject },
        { label: 'Open… (.all, .json)   Ctrl+O', onSelect: () => void open() },
        { label: 'Save   Ctrl+S', onSelect: () => void save(false) },
        { label: 'Save As…   Ctrl+Shift+S', onSelect: () => void save(true) },
        'separator',
        { label: 'Import Datasets… (ASCII)', onSelect: () => void importDatasets() },
        { label: 'Save diagram data', onSelect: saveDiagramData, disabled: !plot.curve },
        { label: 'Export Table as ASCII', onSelect: () => downloadText(`${baseName}-layers.txt`, layerTableToText(project)) },
        'separator',
        ...examples.map((example) => ({ label: example.label, onSelect: () => openExample(example) })),
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo   Ctrl+Z', onSelect: () => dispatch({ type: 'undo' }), disabled: state.history.past.length === 0 },
        { label: 'Redo   Ctrl+Y', onSelect: () => dispatch({ type: 'redo' }), disabled: state.history.future.length === 0 },
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
    {
      label: 'Layer',
      items: [
        { label: 'Add Layer', onSelect: () => dispatch({ type: 'insertLayer' }) },
        {
          label: 'Remove Layer',
          onSelect: () => dispatch({ type: 'removeLayer' }),
          disabled:
            project.sample.mode === 'element'
              ? !canRemoveSlab(project, state.selectedElement, state.selectedLayer)
              : !canRemoveLayer(project, state.selectedLayer),
        },
      ],
    },
    {
      label: 'Tools',
      items: [
        {
          label: 'Script',
          items: [
            { label: 'Open Script Window', onSelect: () => setScriptOpen(true) },
            { label: 'Execute Script: Default', disabled: scriptExecution.busy || scriptExecution.unavailable, onSelect: () => executeScript('default') },
            { label: 'Execute Script: Before Calculation', disabled: scriptExecution.busy || scriptExecution.unavailable, onSelect: () => executeScript('beforeCalculation') },
          ],
        },
        // The electric field follows later (D-26); the layer profile is shown now.
        { label: 'Show layers and electric field', onSelect: () => dispatch({ type: 'setPlotView', plotView: 'opticalProfile' }) },
        { label: 'Summary (coming)', disabled: true },
        {
          label: 'Scratch',
          items: legacyScratchTools.map((label) => ({ label: `${label} (later)`, disabled: true })),
        },
      ],
    },
    { label: 'Preferences', items: [{ label: 'Preferences', onSelect: () => setPreferencesOpen(true) }] },
    {
      label: 'Help',
      items: [
        { label: 'License', onSelect: () => setLicenseOpen(true) },
        { label: 'About', onSelect: () => setAboutOpen(true) },
      ],
    },
  ]

  const elements = project.sample.elementProfiles
  const elementIndex = Math.min(state.selectedElement, Math.max(0, elements.length - 1))
  const materialDialogActive = Boolean(materialDialog && materialDialog.epoch === state.fitEpoch && project.sample.mode === 'compound' && project.sample.layers[materialDialog.index])
  const elementMode = project.sample.mode === 'element'
  const setMode = (mode: 'compound' | 'element') => dispatch({ type: 'updateProject', update: (p) => ({ ...p, sample: { ...p.sample, mode } }) })

  return (
    <div className="app">
      <MenuBar menus={menus} title={unsaved ? `${state.fileName} • unsaved` : state.fileName} />
      <Toolbar
        actions={{
          newProject,
          open: () => void open(),
          save: () => void save(false),
          undo: () => dispatch({ type: 'undo' }),
          redo: () => dispatch({ type: 'redo' }),
          addLayer: () => dispatch({ type: 'insertLayer' }),
          removeLayer: () => dispatch({ type: 'removeLayer' }),
          toggleElementMode: () => setMode(elementMode ? 'compound' : 'element'),
          previousElement: () => dispatch({ type: 'selectElement', index: elementIndex - 1 }),
          nextElement: () => dispatch({ type: 'selectElement', index: elementIndex + 1 }),
          showDensityProfiles: () => dispatch({ type: 'setPlotView', plotView: 'densityProfiles' }),
          openScript: () => setScriptOpen(true),
        }}
        state={{
          canUndo: state.history.past.length > 0,
          canRedo: state.history.future.length > 0,
          canRemoveLayer: elementMode ? canRemoveSlab(project, elementIndex, state.selectedLayer) : canRemoveLayer(project, state.selectedLayer),
          elementMode,
          elementName: elements[elementIndex]?.element ?? null,
          canPreviousElement: elementIndex > 0,
          canNextElement: elementIndex < elements.length - 1,
        }}
      />
      <main className="workspace">
        <div className="layer-stack"><LayerTable onProperties={index => setMaterialDialog({ index, epoch: state.fitEpoch })} /><ValueSlider /></div>
        <PlotPanel curve={plot.curve} measured={plot.measured} />
        <aside className="workspace__side">
          <SidePanel />
          <ModePanel
            busy={calculation.busy || fitStatus.running || fitStatus.evaluating || state.databaseUpdate.busy}
            onStop={() => {
              dispatch({ type: 'setCalculationPaused', paused: true })
              calculation.stop()
            }}
            onCalculate={calculation.recalculate}
          />
        </aside>
      </main>
      <footer className="status-bar" role="status">
        <span className="status-bar__message">
          <span className={calculationError ? 'status-bar__error' : undefined}>
            {calculationError?.split('\n')[0] ?? (calculation.stopped ? 'Stopped.' : null) ?? state.notice ?? (state.databaseUpdate.busy ? 'Updating database values…' : calculation.busy ? 'Calculating…' : `${project.sample.layers.length - 2} ${project.sample.layers.length === 3 ? 'layer' : 'layers'} · ${project.experiment.energy} eV`)}
          </span>
          {calculationError && <button type="button" onClick={() => setCalculationErrorDetails(calculationError)}>Error details</button>}
        </span>
        <span className="status-bar__engine">ReMagX WASM · double precision</span>
      </footer>
      {calculationErrorDetails !== null && calculationErrorDetails === calculationError && <Dialog title="Calculation error" onClose={() => setCalculationErrorDetails(null)}>
        <pre className="dialog__pre calculation-error__detail">{calculationError}</pre>
      </Dialog>}
      {materialDialogActive && materialDialog && <MaterialSettingsDialog index={materialDialog.index} onClose={() => setMaterialDialog(null)} />}
      {!materialDialogActive && !preferencesOpen && !scriptOpen && !aboutOpen && !licenseOpen && !error && !asciiFile && !state.importReport && <DatabaseUpdateReport />}
      {state.importReport && (
        <ImportReportDialog report={state.importReport} fileName={state.fileName.replace('.json', '.all')} onClose={() => dispatch({ type: 'dismissImportReport' })} />
      )}
      {error && (
        <Dialog title="Could not open the file" onClose={() => setError(null)}>
          <pre className="dialog__pre">{error}</pre>
        </Dialog>
      )}
      {asciiFile && (
        <AsciiImportDialog
          fileName={asciiFile.name}
          text={asciiFile.text}
          onCancel={() => setAsciiFile(null)}
          onImport={(dataset) => {
            setAsciiFile(null)
            dispatch({
              type: 'updateProject',
              update: (p) => ({ ...p, datasets: [...p.datasets, dataset], activeDatasetIndex: p.datasets.length }),
            })
          }}
        />
      )}
      {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
      {scriptOpen && (
        <Suspense fallback={null}>
          <ScriptWindow onClose={closeScript} tab={scriptTab} setTab={setScriptTab} execution={scriptExecution} />
        </Suspense>
      )}
      {licenseOpen && (
        <Dialog title="License" onClose={() => setLicenseOpen(false)}>
          <p>
            ReMagX Web is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as
            published by the Free Software Foundation, version 3.
          </p>
          <p>
            It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
            MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the{' '}
            <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer">
              GNU General Public License
            </a>{' '}
            for details.
          </p>
          <p>
            The numerical engine includes GNU C Library components under{' '}
            <a href={`${import.meta.env.BASE_URL}licenses/glibc-LGPL-2.1.txt`} target="_blank" rel="noreferrer">
              LGPL-2.1-or-later
            </a>.{' '}
            <a href={`${import.meta.env.BASE_URL}licenses/NOTICE.txt`} target="_blank" rel="noreferrer">Component notices and source</a>.
          </p>
          <p>Please cite ReMagX and its authors in work that uses results obtained with this software.</p>
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
            <strong>Engine preview:</strong> calculations use the real ReMagX WebAssembly engine. Full validation against original
            projects is still in progress. Unsupported calculations report an error.
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
