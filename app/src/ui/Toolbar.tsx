import { ChartNoAxesCombined, Atom, ChevronLeft, ChevronRight, FileCode, FilePlus, FolderOpen, Redo2, Save, SquareMinus, SquarePlus, Undo2, type LucideIcon } from 'lucide-react'

export interface ToolbarActions {
  newProject: () => void
  open: () => void
  save: () => void
  undo: () => void
  redo: () => void
  addLayer: () => void
  removeLayer: () => void
  toggleElementMode: () => void
  previousElement: () => void
  nextElement: () => void
  showDensityProfiles: () => void
  openScript: () => void
}

export interface ToolbarState {
  canUndo: boolean
  canRedo: boolean
  canRemoveLayer: boolean
  elementMode: boolean
  elementName: string | null
  canPreviousElement: boolean
  canNextElement: boolean
}

function ToolButton({ icon: Icon, label, onClick, disabled, pressed }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button type="button" className="tool-button" title={label} aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled}>
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
    </button>
  )
}

// Icon bar below the menu, like the legacy ToolBar1 (file, layer and element buttons).
export function Toolbar({ actions, state }: { actions: ToolbarActions; state: ToolbarState }) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Toolbar">
      <ToolButton icon={FilePlus} label="New project" onClick={actions.newProject} />
      <ToolButton icon={FolderOpen} label="Open… (Ctrl+O)" onClick={actions.open} />
      <ToolButton icon={Save} label="Save (Ctrl+S)" onClick={actions.save} />
      <span className="toolbar__separator" />
      <ToolButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={actions.undo} disabled={!state.canUndo} />
      <ToolButton icon={Redo2} label="Redo (Ctrl+Y)" onClick={actions.redo} disabled={!state.canRedo} />
      <span className="toolbar__separator" />
      <ToolButton icon={SquarePlus} label="Add layer above the selected one" onClick={actions.addLayer} />
      <ToolButton icon={SquareMinus} label="Remove the selected layer" onClick={actions.removeLayer} disabled={!state.canRemoveLayer} />
      <span className="toolbar__separator" />
      <ToolButton icon={Atom} label={state.elementMode ? 'Switch to compound mode' : 'Switch to element mode'} onClick={actions.toggleElementMode} pressed={state.elementMode} />
      {state.elementMode && (
        <>
          <ToolButton icon={ChartNoAxesCombined} label="Show Density Profiles" onClick={actions.showDensityProfiles} />
          <ToolButton icon={ChevronLeft} label="Previous element" onClick={actions.previousElement} disabled={!state.canPreviousElement} />
          <span className="toolbar__element">{state.elementName ?? '--'}</span>
          <ToolButton icon={ChevronRight} label="Next element" onClick={actions.nextElement} disabled={!state.canNextElement} />
        </>
      )}
      <span className="toolbar__separator" />
      <ToolButton icon={FileCode} label="Open script window" onClick={actions.openScript} />
    </div>
  )
}
