import { spectrumPlot } from '../model/spectrumView'
import { densityProfilePlot } from '../model/densityProfileView'
// Recalculates the curve for the current view whenever the project or view changes, debounced so
// that typing does not flood the worker. Stale results (from an older request) are discarded.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ComputeCancelled, WorkerComputeService, type ComputeService } from '../compute'
import type { OpticalTable } from '../import/tables'
import type { Project } from '../model/project'
import type { DisplayMode, PlotView, ScanKind } from './appState'

import { profilePlot } from '../model/profileView'
import { reflectivityPlot } from '../model/reflectivityView'
import { tensorPlot } from '../model/tensorView'
import type { CalculatedCurve } from '../model/plotCoordinates'
export type { CalculatedCurve, CurveSeries } from '../model/plotCoordinates'

export interface CalculationRequest {
  scanKind: ScanKind
  displayMode: DisplayMode
  plotView: PlotView
  illustrateSegmentation?: boolean
  elementIndex?: number
  layerIndex?: number
  tables?: OpticalTable[]
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

export async function calculateView(service: ComputeService, project: Project, request: CalculationRequest, onScriptMessages?: (lines: string[]) => void): Promise<CalculatedCurve & { scriptMessages?: string[] }> {
  const { scanKind, displayMode: mode, plotView } = request
  if (plotView === 'tensorDiagonal' || plotView === 'tensorUpper' || plotView === 'tensorLower') {
    const tensor = await service.dielectricTensor(project, { layerIndex: request.layerIndex ?? 0, tables: request.tables ?? [], spectrum: true }, onScriptMessages)
    return { ...tensorPlot(tensor, plotView === 'tensorDiagonal' ? 'diagonal' : plotView === 'tensorUpper' ? 'upper' : 'lower'), scriptMessages: tensor.scriptMessages }
  }
  if (plotView === 'densityProfiles') {
    return densityProfilePlot(await service.densityProfiles(project, onScriptMessages, request.tables ?? []))
  }
  if (plotView === 'scatteringFactors') {
    const spectrum = await service.scatteringFactors(project, { elementIndex: request.elementIndex ?? 0, tables: request.tables ?? [] }, onScriptMessages)
    return spectrumPlot(spectrum, plotView)
  }
  if (plotView === 'opticalSpectrum' || plotView === 'magneticSpectrum') {
    const magnetic = plotView === 'magneticSpectrum'
    const spectrum = await service.layerSpectrum(project, { elementIndex: request.elementIndex ?? 0, layerIndex: request.layerIndex ?? 0, magnetic, tables: request.tables ?? [] }, onScriptMessages)
    return spectrumPlot(spectrum, plotView)
  }
  if (plotView !== 'scan') {
    const profile = await service.depthProfile(project, onScriptMessages, request.tables ?? [])
    return { ...profilePlot(profile, plotView === 'magneticProfile', request.illustrateSegmentation ?? true), scriptMessages: profile.scriptMessages }
  }
  if (scanKind === 'energyScan') {
    if (mode !== 'monochromatic') {
      const scan = await service.calcEnergyAsymmetry(project, onScriptMessages, request.tables ?? [])
      return mode === 'dichroic'
        ? { scriptMessages: scan.scriptMessages, axis: 'energy', x: scan.energy, series: [{ label: 'simulated R+', y: scan.reflectivityPlus },
          { label: 'simulated R−', y: scan.reflectivityMinus }], logScale: true, yLabel: 'R' }
        : { scriptMessages: scan.scriptMessages, axis: 'energy', x: scan.energy, series: [{ label: 'simulated asymmetry', y: scan.asymmetry }], logScale: false, yLabel: 'asymmetry' }
    }
    const scan = await service.calcEnergyScan(project, onScriptMessages, request.tables ?? [])
    return { scriptMessages: scan.scriptMessages, axis: 'energy', x: scan.energy, series: [{ label: 'simulated R', y: scan.reflectivity }], logScale: true, yLabel: 'R' }
  }
  if (mode === 'monochromatic') {
    const curve = await service.calcReflectivity(project, onScriptMessages, request.tables ?? [])
    return reflectivityPlot(curve)
  }
  const curve = await service.calcAsymmetry(project, onScriptMessages, request.tables ?? [])
  if (mode === 'dichroic') {
    return {
      scriptMessages: curve.scriptMessages,
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
  return { scriptMessages: curve.scriptMessages, axis: 'qz', x: curve.qz, series: [{ label: 'simulated asymmetry', y: curve.asymmetry }], logScale: false, yLabel: 'asymmetry' }
}

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
