import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { cellIsFitted, toggleCellFit, type CellFitTarget } from '../model/cellFit'
import { useAppState, useDispatch } from '../state/context'
import { NumberCell } from './NumberCell'

export function FittableNumberCell({ fitTarget, extraActions, ...props }: ComponentProps<typeof NumberCell> & { fitTarget: CellFitTarget; extraActions?: ReactNode }) {
  const { project } = useAppState()
  const dispatch = useDispatch()
  const fitted = cellIsFitted(project, fitTarget)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const item = useRef<HTMLButtonElement>(null)
  const close = () => { setPosition(null); root.current?.querySelector('input')?.focus() }
  useEffect(() => {
    if (!position) return
    item.current?.focus()
    const dismiss = (event: Event) => { if (!root.current?.contains(event.target as Node)) setPosition(null) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss) }
  }, [position])
  const open = (left: number, top: number) => setPosition({ left: Math.max(0, Math.min(left, window.innerWidth - 250)), top: Math.max(0, Math.min(top, window.innerHeight - (extraActions ? 120 : 50))) })
  return <div ref={root} className={fitted ? 'fit-cell fit-cell--active' : 'fit-cell'} title={fitted ? 'Included in fit. Right-click or Shift+F10 to turn off.' : 'Right-click or Shift+F10 to include in fit.'}
    onContextMenu={event => { event.preventDefault(); open(event.clientX, event.clientY) }}
    onKeyDown={event => {
      if (event.key === 'Escape' && position) { event.preventDefault(); event.stopPropagation(); close() }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        open(bounds.left, bounds.bottom)
      }
    }}>
    <NumberCell {...props} />
    {position && <div onClick={event => { if ((event.target as HTMLElement).getAttribute('role') === 'menuitem') close() }} role="menu" aria-label={`Fit for ${props.label}`} className="cell-fit-menu" style={{ position: 'fixed', ...position }}>
      <button ref={item} role="menuitemcheckbox" aria-checked={fitted} type="button" onClick={() => { dispatch({ type: 'updateProject', update: current => toggleCellFit(current, fitTarget) }); close() }}>Fit (On/Off)</button>
      {extraActions}
    </div>}
  </div>
}
