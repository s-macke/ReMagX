// Application state: the current project plus UI-only view settings. Components dispatch
// actions; project changes go through the pure helpers in model/.

import { mergeOpticalTables } from '../model/materialLibrary'
import { applyValueSlider, readValueCell, valueCellKey, type ValueCell, type ValueSliderSelection } from '../model/valueSlider'
import { fitStructureChanged } from '../model/fitStructure'
import { createDefaultProject } from '../model/defaults'
import { insertSlabAbove, removeSlab } from '../model/elements'
import { insertLayerAbove, removeLayer, updateLayer } from '../model/layers'
import type { FitParameter, Layer, Project } from '../model/project'
import type { ImportReport } from '../import/allFile'
import type { OpticalTable } from '../import/tables'

export type ScanKind = 'reflectivity' | 'energyScan'
export type DisplayMode = 'monochromatic' | 'dichroic' | 'asymmetry'
export type PlotView = 'densityProfiles' | 'scatteringFactors' | 'opticalSpectrum' | 'magneticSpectrum' | 'scan' | 'opticalProfile' | 'magneticProfile'
export type EnergyUnit = 'eV' | 'angstrom'

export interface FitStatus {
  evaluating: boolean
  running: boolean
  iteration: number
  chi2: number | null
  message: string | null
  // Parameters of the running fit and their current best values, for the live curve.
  parameters: FitParameter[] | null
  values: number[] | null
}

const DEBUG_LOG_LIMIT = 500

export interface AppState {
  project: Project
  valueSlider: ValueSliderSelection | null
  fitEpoch: number // callbacks must match the current fit/evaluation session
  fitInvalidations: number // requests worker cancellation independently of panel mounting
  fileName: string
  selectedLayer: number // row of the layer table (a slab of selectedElement in element mode)
  selectedElement: number
  scanKind: ScanKind
  displayMode: DisplayMode
  plotView: PlotView
  energyUnit: EnergyUnit
  calculationPaused: boolean // Stop pauses automatic redraw until an edit or explicit calculation
  importReport: ImportReport | null // shown after opening a legacy file
  // Per-browser optical-constant library, addressed by material name and table kind.
  opticalTables: OpticalTable[]
  materialLibrary: { ready: boolean; revision: number; savedRevision: number; resetVersion: number; error: string | null; warning: string | null }
  fitStatus: FitStatus
  savedProject: Project // the project as last opened or saved; differs from project when unsaved
  notice: string | null // short message in the status bar (saved, restored, …)
  history: History
  debugLog: string[] // legacy "Debug Window": fit and script messages
}

// Undo/redo stacks of whole projects (projects are immutable, so entries share unchanged parts).
export interface History {
  past: Project[]
  future: Project[]
  lastKey: string | null // coalescing key of the last edit
  lastAt: number
}

const HISTORY_LIMIT = 100
const COALESCE_MS = 1000

export type FitEvent = Extract<Action, { type: 'setFitStatus' | 'updateProject' | 'setCalculationPaused' | 'appendDebug' }>

export type Action =
  | { type: 'selectValueCell'; target: ValueCell; label: string }
  | { type: 'clearValueCell'; key?: string }
  | { type: 'slideValue'; position: number; coalesce: string }
  | { type: 'beginFit'; parameters: FitParameter[] | null }
  | { type: 'fitEvent'; epoch: number; event: FitEvent }
  | { type: 'loadProject'; project: Project; fileName: string; report?: ImportReport; notice?: string; unsaved?: boolean }
  | { type: 'markSaved'; fileName: string }
  | { type: 'setNotice'; notice: string | null }
  // coalesce: consecutive edits with the same key within a second form one undo step
  | { type: 'updateProject'; update: (project: Project) => Project; coalesce?: string }
  | { type: 'updateLayer'; index: number; patch: Partial<Layer>; coalesce?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'selectLayer'; index: number }
  | { type: 'selectElement'; index: number }
  | { type: 'insertLayer' }
  | { type: 'removeLayer' }
  | { type: 'setScanKind'; scanKind: ScanKind }
  | { type: 'setDisplayMode'; displayMode: DisplayMode }
  | { type: 'dismissImportReport' }
  | { type: 'setPlotView'; plotView: PlotView }
  | { type: 'setEnergyUnit'; energyUnit: EnergyUnit }
  | { type: 'restoreOpticalTables'; tables: OpticalTable[]; error: string | null; warning?: string | null }
  | { type: 'materialLibrarySaved'; revision: number }
  | { type: 'materialLibraryFailed'; revision: number; error: string }
  | { type: 'addOpticalTables'; tables: OpticalTable[] }
  | { type: 'clearOpticalTables' }
  | { type: 'setCalculationPaused'; paused: boolean }
  | { type: 'setFitStatus'; fitStatus: Partial<FitStatus> }
  | { type: 'appendDebug'; lines: string[] }
  | { type: 'clearDebug' }

export function initialState(): AppState {
  const project = createDefaultProject()
  return {
    project,
    valueSlider: null,
    fitEpoch: 0,
    fitInvalidations: 0,
    savedProject: project,
    notice: null,
    history: { past: [], future: [], lastKey: null, lastAt: 0 },
    fileName: 'default.json',
    selectedLayer: 1,
    selectedElement: 0,
    scanKind: 'reflectivity',
    displayMode: 'monochromatic',
    plotView: 'scan',
    energyUnit: 'eV',
    calculationPaused: false,
    importReport: null,
    opticalTables: [],
    materialLibrary: { ready: false, revision: 0, savedRevision: 0, resetVersion: 0, error: null, warning: null },
    fitStatus: { evaluating: false, running: false, iteration: 0, chi2: null, message: null, parameters: null, values: null },
    debugLog: [],
  }
}

const emptyHistory = (): History => ({ past: [], future: [], lastKey: null, lastAt: 0 })

// Wraps the state transitions with undo history: every change of the project is recorded,
// loading a project starts a fresh history.
function invalidateFit(state: AppState, message: string): AppState {
  const active = state.fitStatus.running || state.fitStatus.evaluating
  return { ...state, fitEpoch: state.fitEpoch + 1, fitInvalidations: state.fitInvalidations + Number(active),
    fitStatus: { ...state.fitStatus, running: false, evaluating: false, parameters: null, values: null, chi2: null,
      message: active ? message : state.fitStatus.message } }
}

export function reducer(state: AppState, action: Action): AppState {
  if (action.type === 'fitEvent') return action.epoch === state.fitEpoch ? reducer(state, action.event) : state
  if (action.type === 'undo' || action.type === 'redo') {
    const { past, future } = state.history
    const from = action.type === 'undo' ? past : future
    if (from.length === 0) return state
    const project = from[from.length - 1]
    const rest = from.slice(0, -1)
    const history: History =
      action.type === 'undo'
        ? { past: rest, future: [...future, state.project], lastKey: null, lastAt: 0 }
        : { past: [...past, state.project], future: rest, lastKey: null, lastAt: 0 }
    const next = { ...state, project, history, notice: null, calculationPaused: false, valueSlider: null }
    return invalidateFit(next, 'Fit cancelled by undo/redo.')
  }

  let next = transition(state, action)
  if (action.type === 'loadProject') return { ...invalidateFit(next, 'Fit cancelled because a project was loaded.'), history: emptyHistory(), calculationPaused: false, valueSlider: null }
  if (next.project === state.project) return next
  if (fitStructureChanged(state.project, next.project)) next = { ...invalidateFit(next, 'Fit cancelled because project structure changed.'), valueSlider: null }
  if (next.valueSlider && action.type !== 'slideValue') {
    const value = readValueCell(next.project, next.valueSlider.target)
    if (value === undefined) next = { ...next, valueSlider: null }
    else if (value !== readValueCell(state.project, next.valueSlider.target)) next = { ...next, valueSlider: { ...next.valueSlider, originalValue: value, position: 250 } }
  }

  const now = Date.now()
  const key = 'coalesce' in action ? (action.coalesce ?? null) : null
  const merge = key !== null && key === state.history.lastKey && (action.type === 'slideValue' || now - state.history.lastAt < COALESCE_MS)
  const past = merge ? state.history.past : [...state.history.past, state.project].slice(-HISTORY_LIMIT)
  return { ...next, notice: null, calculationPaused: false, history: { past, future: [], lastKey: key, lastAt: now } }
}

function transition(state: AppState, action: Exclude<Action, { type: 'undo' } | { type: 'redo' }>): AppState {
  switch (action.type) {
    case 'selectValueCell': {
      const value = readValueCell(state.project, action.target)
      return { ...state, valueSlider: value === undefined ? null : { target: action.target, label: action.label, originalValue: value, position: 250 } }
    }
    case 'clearValueCell':
      return !action.key || (state.valueSlider && valueCellKey(state.valueSlider.target) === action.key) ? { ...state, valueSlider: null } : state
    case 'slideValue': {
      if (!state.valueSlider || !Number.isInteger(action.position) || action.position < 0 || action.position > 1000 || !Number.isFinite(action.position / 250 * state.valueSlider.originalValue)) return state
      const project = applyValueSlider(state.project, state.valueSlider, action.position)
      return { ...state, project, valueSlider: { ...state.valueSlider, position: action.position } }
    }
    case 'fitEvent': return state // handled by the reducer wrapper
    case 'beginFit':
      return { ...state, fitEpoch: state.fitEpoch + 1, fitStatus: { running: action.parameters !== null, evaluating: action.parameters === null, iteration: 0, chi2: null, parameters: action.parameters, values: null, message: action.parameters === null ? 'Calculating χ²…' : 'Fitting…' } }
    case 'loadProject':
      return {
        ...state,
        project: action.project,
        // An imported legacy file or a restored autosave has not been saved as a project yet.
        savedProject: action.unsaved ? state.savedProject : action.project,
        fileName: action.fileName,
        selectedLayer: 1,
        selectedElement: 0,
        importReport: action.report ?? null,
        notice: action.notice ?? null,
      }
    case 'markSaved':
      return { ...state, savedProject: state.project, fileName: action.fileName, notice: `Saved ${action.fileName}.` }
    case 'setNotice':
      return { ...state, notice: action.notice }
    case 'updateProject':
      return { ...state, project: action.update(state.project) }
    case 'updateLayer':
      return { ...state, project: updateLayer(state.project, action.index, action.patch) }
    case 'selectLayer':
      return { ...state, selectedLayer: action.index }
    case 'selectElement':
      return { ...state, selectedElement: action.index, selectedLayer: 1, valueSlider: null }
    // In element mode, Add/Remove Layer act on the slabs of the selected element.
    case 'insertLayer': {
      const { project, inserted } =
        state.project.sample.mode === 'element'
          ? insertSlabAbove(state.project, state.selectedElement, state.selectedLayer)
          : insertLayerAbove(state.project, state.selectedLayer)
      return { ...state, project, selectedLayer: inserted }
    }
    case 'removeLayer': {
      const element = state.project.sample.mode === 'element'
      const project = element
        ? removeSlab(state.project, state.selectedElement, state.selectedLayer)
        : removeLayer(state.project, state.selectedLayer)
      const rows = element ? (project.sample.elementProfiles[state.selectedElement]?.slabs.length ?? 2) : project.sample.layers.length
      return { ...state, project, selectedLayer: Math.max(1, Math.min(state.selectedLayer, rows - 2)) }
    }
    case 'setScanKind':
      return { ...state, scanKind: action.scanKind, plotView: 'scan', calculationPaused: false }
    case 'setDisplayMode':
      return { ...state, displayMode: action.displayMode, calculationPaused: false }
    case 'dismissImportReport':
      return { ...state, importReport: null }
    case 'setPlotView':
      return { ...state, plotView: action.plotView, calculationPaused: false }
    case 'setEnergyUnit':
      return { ...state, energyUnit: action.energyUnit }
    case 'restoreOpticalTables':
      return { ...state, opticalTables: state.materialLibrary.resetVersion > 0 ? state.opticalTables : mergeOpticalTables(action.tables, state.opticalTables),
        materialLibrary: { ...state.materialLibrary, ready: true, error: action.error, warning: action.warning ?? null } }
    case 'materialLibrarySaved':
      return { ...state, materialLibrary: { ...state.materialLibrary, savedRevision: action.revision,
        warning: action.revision === state.materialLibrary.revision && state.materialLibrary.resetVersion > 0 ? null : state.materialLibrary.warning,
        error: action.revision === state.materialLibrary.revision ? null : state.materialLibrary.error } }
    case 'materialLibraryFailed':
      return action.revision === state.materialLibrary.revision ? { ...state, materialLibrary: { ...state.materialLibrary, error: action.error } } : state
    case 'addOpticalTables':
      return { ...state, opticalTables: mergeOpticalTables(state.opticalTables, action.tables),
        materialLibrary: { ...state.materialLibrary, revision: state.materialLibrary.revision + 1 } }
    case 'clearOpticalTables':
      return { ...state, opticalTables: [], materialLibrary: { ...state.materialLibrary,
        revision: state.materialLibrary.revision + 1, resetVersion: state.materialLibrary.resetVersion + 1 } }
    case 'setCalculationPaused':
      return { ...state, calculationPaused: action.paused }
    case 'setFitStatus':
      return { ...state, fitStatus: { ...state.fitStatus, ...action.fitStatus } }
    case 'appendDebug':
      return { ...state, debugLog: [...state.debugLog, ...action.lines].slice(-DEBUG_LOG_LIMIT) }
    case 'clearDebug':
      return { ...state, debugLog: [] }
  }
}

