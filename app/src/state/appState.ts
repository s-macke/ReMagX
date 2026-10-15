// Application state: the current project plus UI-only view settings. Components dispatch
// actions; project changes go through the pure helpers in model/.

import { createDefaultProject } from '../model/defaults'
import { insertLayerAbove, removeLayer, updateLayer } from '../model/layers'
import type { Layer, Project } from '../model/project'
import type { ImportReport } from '../import/allFile'

export type ScanKind = 'reflectivity' | 'energyScan'
export type DisplayMode = 'monochromatic' | 'dichroic' | 'asymmetry' | 'sensitivity'

export interface AppState {
  project: Project
  fileName: string
  selectedLayer: number
  scanKind: ScanKind
  displayMode: DisplayMode
  importReport: ImportReport | null // shown after opening a legacy file
}

export type Action =
  | { type: 'loadProject'; project: Project; fileName: string; report?: ImportReport }
  | { type: 'updateProject'; update: (project: Project) => Project }
  | { type: 'updateLayer'; index: number; patch: Partial<Layer> }
  | { type: 'selectLayer'; index: number }
  | { type: 'insertLayer' }
  | { type: 'removeLayer' }
  | { type: 'setScanKind'; scanKind: ScanKind }
  | { type: 'setDisplayMode'; displayMode: DisplayMode }
  | { type: 'dismissImportReport' }

export function initialState(): AppState {
  return {
    project: createDefaultProject(),
    fileName: 'default.json',
    selectedLayer: 1,
    scanKind: 'reflectivity',
    displayMode: 'monochromatic',
    importReport: null,
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'loadProject':
      return {
        ...state,
        project: action.project,
        fileName: action.fileName,
        selectedLayer: Math.min(1, action.project.sample.layers.length - 1),
        importReport: action.report ?? null,
      }
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
      return { ...state, scanKind: action.scanKind }
    case 'setDisplayMode':
      return { ...state, displayMode: action.displayMode }
    case 'dismissImportReport':
      return { ...state, importReport: null }
  }
}

