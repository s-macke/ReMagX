import { useEffect, useState } from 'react'
import { applyElementConversion, type ElementConversion } from '../model/materialElements'
import { useAppState, useDispatch } from '../state/context'
import { computeService } from '../state/useCalculation'
import { Dialog } from './Dialog'

export function MaterialElementsAction() {
  const { fitStatus, databaseUpdate } = useAppState()
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" disabled={fitStatus.running || fitStatus.evaluating || databaseUpdate.busy} onClick={() => setOpen(true)}>Material to Elements</button>
    {open && <ConversionDialog onClose={() => setOpen(false)} />}
  </>
}

function ConversionDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState()
  const dispatch = useDispatch()
  const [source] = useState(() => ({ project: state.project, epoch: state.fitEpoch }))
  const [result, setResult] = useState<ElementConversion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stale = source.project !== state.project || source.epoch !== state.fitEpoch
  useEffect(() => {
    let active = true
    void computeService().materialToElements(source.project).then(result => {
      if (result.elements.length) applyElementConversion(source.project, result)
      if (active) setResult(result)
    })
      .catch((error: Error) => { if (active) setError(error.message) })
    return () => { active = false }
  }, [source])
  const close = () => { if (!result && !error) computeService().stop(); onClose() }
  const removedFits = result?.elements.length ? applyElementConversion(source.project, result).removedFits : 0
  return <Dialog title="Material to Elements" onClose={close} actions={<>
    <button type="button" disabled={!result?.elements.length || stale || !!error} onClick={() => {
      if (!result?.elements.length || stale) return
      dispatch({ type: 'applyElementConversion', source: source.project, epoch: source.epoch, result })
      onClose()
    }}>Replace element data</button>
    <button type="button" onClick={close}>Cancel</button>
  </>}>
    <p>Convert the retained material stack using legacy formula syntax and atomic masses. The material stack stays available. Existing element data will be replaced; Undo restores it.</p>
    <p>Scattering factors start at zero, as in legacy conversion. Load tables and use “Get f1/f2 from database” before calculations. Multilayer-script expansion is not available in the mock engine.</p>
    {stale && <p role="alert">The project or fit session changed. Close this preview and run the action again.</p>}
    {error ? <p role="alert">{error}</p> : !result ? <p>Converting… <button type="button" onClick={() => computeService().stop()}>Stop calculation</button></p> : <>
      <p>{result.elements.length} element(s): {result.elements.map(element => element.element).join(', ') || 'none'}. {source.project.sample.elementProfiles.length} existing element stack(s) will be replaced.</p>
      <p>{removedFits} element-specific fit parameter(s) will be removed. Compound-layer, profile and global fit parameters are retained.</p>
      {!result.elements.length && <p role="alert">No elements were generated. Correct the material formulas/densities and try again.</p>}
      <ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </>}
  </Dialog>
}
