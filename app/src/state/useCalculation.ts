// Recalculates the curve for the current view whenever the project or view changes, debounced so
// that typing does not flood the worker. Stale results (from an older request) are discarded.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ComputeCancelled, WorkerComputeService, type ComputeService } from '../compute'
import type { Project } from '../model/project'
import type { DisplayMode, PlotView, ScanKind } from './appState'

import type { CalculatedCurve } from '../model/plotCoordinates'
export type { CalculatedCurve, CurveSeries } from '../model/plotCoordinates'

export interface CalculationRequest {
  scanKind: ScanKind
  displayMode: DisplayMode
  plotView: PlotView
}

export interface CalculationState {
  curve: CalculatedCurve | null
  error: string | null
  busy: boolean
  stopped: boolean
}

const DEBOUNCE_MS = 120

let sharedService: ComputeService | null = null
export function computeService(): ComputeService {
  sharedService ??= new WorkerComputeService()
  return sharedService
}

// A structural edit makes all old worker work unusable. Dispose immediately so
// the new project can calculate without waiting for cooperative fit cancellation.
export function discardComputeService(): void {
  sharedService?.dispose()
  sharedService = null
}

async function calculate(service: ComputeService, project: Project, request: CalculationRequest): Promise<CalculatedCurve> {
  const { scanKind, displayMode: mode, plotView } = request
  if (plotView !== 'scan') {
    const profile = await service.depthProfile(project)
    const magnetic = plotView === 'magneticProfile'
    return {
      axis: 'z',
      x: profile.z,
      series: magnetic
        ? [
            { label: 'δm', y: profile.deltaMag },
            { label: 'βm', y: profile.betaMag },
          ]
        : [
            { label: 'δ', y: profile.delta },
            { label: 'β', y: profile.beta },
          ],
      logScale: false,
      yLabel: magnetic ? 'magnetic optical constants' : 'optical constants',
    }
  }
  if (scanKind === 'energyScan') {
    if (mode !== 'monochromatic') throw new Error('Dichroic and asymmetry energy scans are not available in the mock engine yet.')
    const scan = await service.calcEnergyScan(project)
    return { axis: 'energy', x: scan.energy, series: [{ label: 'simulated R', y: scan.reflectivity }], logScale: true, yLabel: 'R' }
  }
  if (mode === 'monochromatic') {
    const curve = await service.calcReflectivity(project)
    return { axis: 'qz', x: curve.qz, series: [{ label: 'simulated R', y: curve.reflectivity }], logScale: true, yLabel: 'R' }
  }
  const curve = await service.calcAsymmetry(project)
  if (mode === 'dichroic') {
    return {
      axis: 'qz',
      x: curve.qz,
      series: [
        { label: 'simulated R+', y: curve.reflectivityPlus },
        { label: 'simulated R−', y: curve.reflectivityMinus },
      ],
      logScale: true,
      yLabel: 'R',
    }
  }
  return { axis: 'qz', x: curve.qz, series: [{ label: 'simulated asymmetry', y: curve.asymmetry }], logScale: false, yLabel: 'asymmetry' }
}

export function useCalculation(project: Project, request: CalculationRequest, paused = false) {
  const { scanKind, displayMode, plotView } = request
  const [state, setState] = useState<CalculationState>({ curve: null, error: null, busy: true, stopped: false })
  const requestId = useRef(0)
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
      setState((s) => ({ ...s, busy: true, stopped: false, error: null }))
      calculate(computeService(), project, { scanKind, displayMode, plotView })
        .then((curve) => {
          if (active && id === requestId.current) setState({ curve, error: null, busy: false, stopped: false })
        })
        .catch((error: Error) => {
          if (active && id === requestId.current) setState((s) => ({ curve: s.curve, error: error instanceof ComputeCancelled ? null : error.message, busy: false, stopped: error instanceof ComputeCancelled }))
        })
    }, DEBOUNCE_MS)
    debounceTimer.current = timer
    return () => {
      clearTimeout(timer)
      debounceTimer.current = null
      active = false
    }
  }, [project, scanKind, displayMode, plotView, revision, paused])

  return { ...(paused ? { ...state, busy: false, stopped: true, error: null } : state), stop, recalculate }
}
