import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ComputeCancelled, type ComputeService } from '../compute'
import type { ScriptProgram } from '../model/manualScript'
import { useAppState, useDispatch } from './context'
import { computeService } from '../compute/sharedComputeService'

export function useScriptExecution() {
  const { project, opticalTables, fitEpoch, fitStatus, databaseUpdate } = useAppState()
  const dispatch = useDispatch()
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState<string[]>([])
  const current = useRef({ project, opticalTables, fitEpoch })
  useLayoutEffect(() => { current.current = { project, opticalTables, fitEpoch } }, [project, opticalTables, fitEpoch])
  const active = useRef<{ service: ComputeService; source: typeof current.current } | null>(null)
  const append = (lines: string[]) => setOutput(previous => [...previous, ...lines])

  useEffect(() => {
    const request = active.current
    if (request && (request.source.project !== project || request.source.opticalTables !== opticalTables || request.source.fitEpoch !== fitEpoch)) {
      active.current = null
      request.service.stop()
      setBusy(false)
      setOutput(previous => [...previous, 'Script stopped because the project, table library or calculation session changed.'])
    }
  }, [project, opticalTables, fitEpoch])
  useEffect(() => () => {
    const request = active.current
    active.current = null
    request?.service.stop()
  }, [])

  const stop = () => {
    const request = active.current
    if (!request) return
    active.current = null
    request.service.stop()
    setBusy(false)
    append(['Stopped.'])
    dispatch({ type: 'setCalculationPaused', paused: true })
  }
  const execute = (program: ScriptProgram) => {
    if (active.current || fitStatus.running || fitStatus.evaluating || databaseUpdate.busy) return
    const service = computeService(), source = current.current
    service.stop()
    dispatch({ type: 'setCalculationPaused', paused: true })
    const request = { service, source }
    active.current = request
    setBusy(true)
    append([`Execute (${program})`])
    const valid = () => active.current === request && current.current.project === source.project &&
      current.current.opticalTables === source.opticalTables && current.current.fitEpoch === source.fitEpoch
    let streamed = false
    void service.executeScript(source.project, program, lines => {
      if (valid() && lines.length) { streamed = true; append(lines) }
    }, source.opticalTables).then(result => {
      if (!valid()) return
      if (!streamed && result.scriptMessages.length) append(result.scriptMessages)
      active.current = null
      setBusy(false)
      dispatch({ type: 'applyScriptExecution', source: source.project, tables: source.opticalTables, epoch: source.fitEpoch, result })
      append(['Script finished.'])
    }).catch((error: Error) => {
      if (!valid()) return
      active.current = null
      setBusy(false)
      append([error instanceof ComputeCancelled ? 'Stopped.' : error.message])
    })
  }
  return { execute, stop, busy, output, append, clearOutput: () => setOutput([]), unavailable: fitStatus.running || fitStatus.evaluating || databaseUpdate.busy }
}
