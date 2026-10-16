import { useEffect, useState } from 'react'
import { applyLayerConversion } from '../model/layerConversion'
import type { Layer } from '../model/project'
import { useAppState, useDispatch } from '../state/context'
import { computeService } from '../state/useCalculation'
import { Dialog } from './Dialog'

export function LayerConversionDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState()
  const dispatch = useDispatch()
  const [source] = useState(() => ({ project: state.project, epoch: state.fitEpoch, tables: state.opticalTables }))
  const [result, setResult] = useState<{ layers: Layer[]; notes: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stale = source.project !== state.project || source.epoch !== state.fitEpoch || source.tables !== state.opticalTables
  useEffect(() => {
    let active = true
    void computeService().segmentLayers(source.project).then(layers => {
      const conversion = applyLayerConversion(source.project, layers)
      if (active) setResult({ layers, notes: conversion.notes })
    }).catch((error: Error) => { if (active) setError(error.message) })
    return () => { active = false }
  }, [source])
  const close = () => { if (!result && !error) computeService().stop(); onClose() }
  return <Dialog title="To layer list" onClose={close} actions={<>
    <button type="button" disabled={!result || stale || !!error} onClick={() => {
      if (!result || stale) return
      dispatch({ type: 'applyLayerConversion', source: source.project, epoch: source.epoch, tables: source.tables, layers: result.layers })
      onClose()
    }}>Apply mock layers</button>
    <button type="button" onClick={close}>Cancel</button>
  </>}>
    <p>Mock conversion: fixed profile intervals, not adaptive segmentation. Automatic table updates and BeforeCalculation are not executed.</p>
    <p>Generated layers have zero roughness and “unknown” material/database names. Density, magnetization direction and escape depth are copied from the original layer at each interval midpoint. Optical values are sampled from the mock profile.</p>
    {stale && <p role="alert">The project, fit session or table library changed. Close this preview and run the action again.</p>}
    {error ? <p role="alert">{error}</p> : !result ? <p>Generating layers… <button type="button" onClick={() => computeService().stop()}>Stop calculation</button></p> : <ul>{result.notes.map(note => <li key={note}>{note}</li>)}</ul>}
  </Dialog>
}
