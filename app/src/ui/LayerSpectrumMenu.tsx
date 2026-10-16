import { useEffect, useRef } from 'react'
import { useDatabaseUpdate } from '../state/useDatabaseUpdate'
import { useAppState, useDispatch } from '../state/context'

export function LayerSpectrumActions({ index, close, onProperties }: { index: number; close?: () => void; onProperties: (index: number) => void }) {
  const dispatch = useDispatch()
  const updateDatabase = useDatabaseUpdate()
  const { databaseUpdate } = useAppState()
  return <>{(['opticalSpectrum', 'magneticSpectrum'] as const).map(plotView => (
    <button key={plotView} type="button" role="menuitem" onClick={() => {
      dispatch({ type: 'selectLayer', index })
      dispatch({ type: 'setPlotView', plotView })
      close?.()
    }}>{plotView === 'opticalSpectrum' ? 'Show δ and β spectrum' : 'Show δm and βm spectrum'}</button>
  ))}{([
    ['tensorDiagonal', 'Show diagonal part of dielectric tensor'],
    ['tensorUpper', 'Show top off diagonal part of dielectric tensor'],
    ['tensorLower', 'Show bottom off diagonal part of dielectric tensor'],
  ] as const).map(([plotView, label]) => <button key={plotView} type="button" role="menuitem" onClick={() => {
    dispatch({ type: 'selectLayer', index }); dispatch({ type: 'setPlotView', plotView }); close?.()
  }}>{label}</button>)}<button type="button" role="menuitem" disabled={databaseUpdate.busy} onClick={() => { updateDatabase(); close?.() }}>Get optical constants from database</button><button type="button" role="menuitem" onClick={() => { onProperties(index); close?.() }}>Properties</button></>
}

export interface LayerMenuPosition { index: number; left: number; top: number; anchor: HTMLElement }

export function LayerSpectrumMenu({ position, close, onProperties }: { position: LayerMenuPosition; close: () => void; onProperties: (index: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const dismiss = (event: Event) => { if (!ref.current?.contains(event.target as Node)) close() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss) }
  }, [close])
  return <div ref={ref} role="menu" aria-label="Layer spectra" className="cell-fit-menu" style={{ position: 'fixed', left: Math.max(0, Math.min(position.left, window.innerWidth - 250)), top: Math.max(0, Math.min(position.top, window.innerHeight - 340)) }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); position.anchor.focus() } }}>
    <LayerSpectrumActions index={position.index} close={close} onProperties={onProperties} />
  </div>
}
