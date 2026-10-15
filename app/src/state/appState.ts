// Application state: the current project plus UI-only view settings. Components dispatch
// actions; project changes go through the pure helpers in model/.

import { createDefaultProject } from '../model/defaults'
import { insertLayerAbove, removeLayer, updateLayer } from '../model/layers'
import type { Layer, Project } from '../model/project'
import type { ImportReport } from '../import/allFile'
import type { OpticalTable } from '../import/tables'

export type ScanKind = 'reflectivity' | 'energyScan'
export type DisplayMode = 'monochromatic' | 'dichroic' | 'asymmetry' | 'sensitivity'
export type PlotView = 'scan' | 'opticalProfile' | 'magneticProfile'
export type EnergyUnit = 'eV' | 'angstrom'

export interface FitStatus {
  running: boolean
  iteration: number
  chi2: number | null
  message: string | null
}

export interface AppState {
  project: Project
  fileName: string
  selectedLayer: number
  scanKind: ScanKind
  displayMode: DisplayMode
  plotView: PlotView
  energyUnit: EnergyUnit
  importReport: ImportReport | null // shown after opening a legacy file
  // Optical-constant tables loaded in this browser session, by file name (Co.db, Co.m, ...).
  opticalTables: OpticalTable[]
  fitStatus: FitStatus
  savedProject: Project // the project as last opened or saved; differs from project when unsaved
  notice: string | null // short message in the status bar (saved, restored, …)
}

export type Action =
  | { type: 'loadProject'; project: Project; fileName: string; report?: ImportReport; notice?: string; unsaved?: boolean }
  | { type: 'markSaved'; fileName: string }
  | { type: 'setNotice'; notice: string | null }
  | { type: 'updateProject'; update: (project: Project) => Project }
  | { type: 'updateLayer'; index: number; patch: Partial<Layer> }
  | { type: 'selectLayer'; index: number }
  | { type: 'insertLayer' }
  | { type: 'removeLayer' }
  | { type: 'setScanKind'; scanKind: ScanKind }
  | { type: 'setDisplayMode'; displayMode: DisplayMode }
  | { type: 'dismissImportReport' }
  | { type: 'setPlotView'; plotView: PlotView }
  | { type: 'setEnergyUnit'; energyUnit: EnergyUnit }
  | { type: 'addOpticalTables'; tables: OpticalTable[] }
  | { type: 'clearOpticalTables' }
  | { type: 'setFitStatus'; fitStatus: Partial<FitStatus> }

export function initialState(): AppState {
  const project = createDefaultProject()
  return {
    project,
    savedProject: project,
    notice: null,
    fileName: 'default.json',
    selectedLayer: 1,
    scanKind: 'reflectivity',
    displayMode: 'monochromatic',
    plotView: 'scan',
    energyUnit: 'eV',
    importReport: null,
    opticalTables: [],
    fitStatus: { running: false, iteration: 0, chi2: null, message: null },
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'loadProject':
      return {
        ...state,
        project: action.project,
        // An imported legacy file or a restored autosave has not been saved as a project yet.
        savedProject: action.unsaved ? state.savedProject : action.project,
        fileName: action.fileName,
        selectedLayer: Math.min(1, action.project.sample.layers.length - 1),
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
    case 'insertLayer': {
      const { project, inserted } = insertLayerAbove(state.project, state.selectedLayer)
      return { ...state, project, selectedLayer: inserted }
    }
    case 'removeLayer': {
      const project = removeLayer(state.project, state.selectedLayer)
      return { ...state, project, selectedLayer: Math.min(state.selectedLayer, project.sample.layers.length - 2) }
    }
    case 'setScanKind':
      return { ...state, scanKind: action.scanKind, plotView: 'scan' }
    case 'setDisplayMode':
      return { ...state, displayMode: action.displayMode }
    case 'dismissImportReport':
      return { ...state, importReport: null }
    case 'setPlotView':
      return { ...state, plotView: action.plotView }
    case 'setEnergyUnit':
      return { ...state, energyUnit: action.energyUnit }
    case 'addOpticalTables': {
      const key = (t: OpticalTable) => `${t.name}.${t.kind}`
      const replaced = new Set(action.tables.map(key))
      return { ...state, opticalTables: [...state.opticalTables.filter((t) => !replaced.has(key(t))), ...action.tables] }
    }
    case 'clearOpticalTables':
      return { ...state, opticalTables: [] }
    case 'setFitStatus':
      return { ...state, fitStatus: { ...state.fitStatus, ...action.fitStatus } }
  }
}

