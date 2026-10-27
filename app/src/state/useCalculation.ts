// Recalculates the current view with debounce and stale-result protection.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ComputeCancelled } from '../compute/ComputeService'
import { computeService } from '../compute/sharedComputeService'
import { calculateView, type CalculationRequest } from '../compute/calculateView'
import type { Project } from '../model/project'
import type { CalculatedCurve } from '../model/plotCoordinates'

export interface CalculationState {
  curve: CalculatedCurve | null
  error: string | null
  busy: boolean
  stopped: boolean
}

const DEBOUNCE_MS = 120

export function useCalculation(project: Project, request: CalculationRequest, paused = false, live = false, onScriptMessages?: (lines: string[]) => void) {
  const { scanKind, displayMode, plotView, illustrateSegmentation, layerIndex, elementIndex, tables } = request
  const [state, setState] = useState<CalculationState>({ curve: null, error: null, busy: true, stopped: false })
  const requestId = useRef(0)
  const lastCalculation = useRef(-Infinity)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [revision, setRevision] = useState(0)
  const recalculate = useCallback(() => setRevision((value) => value + 1), [])
  const stop = useCallback(() => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    debounceTimer.current = null
    ++requestId.current
    computeService().stop()
    setState((s) => ({ ...s, busy: false, error: null, stopped: true }))
  }, [])

  useEffect(() => {
    const id = ++requestId.current
    if (paused) return
    let active = true
    const timer = setTimeout(() => {
      debounceTimer.current = null
      lastCalculation.current = performance.now()
      setState((s) => ({ ...s, busy: true, stopped: false, error: null }))
      let streamed = false
      const receiveMessages = (lines: string[]) => {
        if (active && id === requestId.current && lines.length) {
          streamed = true
          onScriptMessages?.(lines)
        }
      }
      calculateView(computeService(), project, { scanKind, displayMode, plotView, illustrateSegmentation, layerIndex, elementIndex, tables }, receiveMessages)
        .then(({ scriptMessages, ...curve }) => {
          if (active && id === requestId.current) {
            setState({ curve, error: null, busy: false, stopped: false })
            if (!streamed && scriptMessages?.length) onScriptMessages?.(scriptMessages)
          }
        })
        .catch((error: Error) => {
          if (active && id === requestId.current) setState((s) => ({ curve: s.curve, error: error instanceof ComputeCancelled ? null : error.message, busy: false, stopped: error instanceof ComputeCancelled }))
        })
    }, live ? Math.max(0, DEBOUNCE_MS - (performance.now() - lastCalculation.current)) : DEBOUNCE_MS)
    debounceTimer.current = timer
    return () => {
      clearTimeout(timer)
      debounceTimer.current = null
      active = false
    }
  }, [project, scanKind, displayMode, plotView, illustrateSegmentation, layerIndex, elementIndex, tables, revision, paused, live, onScriptMessages])

  return { ...(paused ? { ...state, busy: false, stopped: true, error: null } : state), stop, recalculate }
}
