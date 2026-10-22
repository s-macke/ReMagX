import { useEffect, useState } from 'react'
import { applyLayerConversion } from '../model/layerConversion'
import type { LayerConversionResult } from '../compute/ComputeService'
import { useAppState, useDispatch } from '../state/context'
import { computeService } from '../state/useCalculation'
import { Dialog } from './Dialog'

export function LayerConversionDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState()
  const dispatch = useDispatch()
  const [source] = useState(() => ({ project: state.project, epoch: state.fitEpoch, tables: state.opticalTables }))
  const [result, setResult] = useState<LayerConversionResult & { notes: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stale = source.project !== state.project || source.epoch !== state.fitEpoch || source.tables !== state.opticalTables
  useEffect(() => {
    let active = true
    void computeService().segmentLayers(source.project, undefined, source.tables).then(result => {
      const conversion = applyLayerConversion(source.project, result.layers)
      if (active) setResult({ ...result, notes: conversion.notes })
    }).catch((error: Error) => { if (active) setError(error.message) })
    return () => { active = false }
  }, [source])
  const close = () => { if (!result && !error) computeService().stop(); onClose() }
  return <Dialog title="To layer list" onClose={close} actions={<>
    <button type="button" disabled={!result || stale || !!error} onClick={() => {
      if (!result || stale) return
      dispatch({ type: 'applyLayerConversion', source: source.project, epoch: source.epoch, tables: source.tables, layers: result.layers })
      onClose()
    }}>{result?.engine === 'mock' ? 'Apply mock layers' : 'Apply layers'}</button>
    <button type="button" onClick={close}>Cancel</button>
  </>}>
    {result?.engine === 'mock' && <><p>Mock conversion: fixed profile intervals, not adaptive segmentation. Automatic table updates and BeforeCalculation are not executed.</p>
    <p>Generated layers have zero roughness and “unknown” material/database names. Density, magnetization direction and escape depth are copied from the original layer at each interval midpoint. Optical values are sampled from the mock profile.</p></>}
    {result?.engine === 'real' && <p>Real conversion: generated optical values and tensors, with zero roughness, density and escape depth. Database names become “unknown”; material names are empty. Automatic optical-constant updates and enabled BeforeCalculation scripts are evaluated before conversion.</p>}
    {result?.scriptMessages?.length ? <pre>{result.scriptMessages.join('\n')}</pre> : null}
    {stale && <p role="alert">The project, fit session or table library changed. Close this preview and run the action again.</p>}
    {error ? <p role="alert">{error}</p> : !result ? <p>Generating layers… <button type="button" onClick={() => computeService().stop()}>Stop calculation</button></p> : <ul>{result.notes.map(note => <li key={note}>{note}</li>)}</ul>}
  </Dialog>
}
