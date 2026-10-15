// Recalculates the curve for the current view whenever the project or view changes, debounced so
// that typing does not flood the worker. Stale results (from an older request) are discarded.

import { useEffect, useRef, useState } from 'react'
import { WorkerComputeService, type ComputeService } from '../compute'
import type { Project } from '../model/project'
import type { DisplayMode, PlotView, ScanKind } from './appState'

export interface CurveSeries {
  label: string
  y: number[]
}

export interface CalculatedCurve {
  axis: 'qz' | 'energy' | 'z'
  x: number[]
  series: CurveSeries[]
  logScale: boolean
  yLabel: string
}

export interface CalculationRequest {
  scanKind: ScanKind
  displayMode: DisplayMode
  plotView: PlotView
}

export interface CalculationState {
  curve: CalculatedCurve | null
  error: string | null
  busy: boolean
}

const DEBOUNCE_MS = 120

let sharedService: ComputeService | null = null
export function computeService(): ComputeService {
  sharedService ??= new WorkerComputeService()
  return sharedService
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
  if (mode === 'sensitivity') throw new Error('The sensitivity view is not available yet.')
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

export function useCalculation(project: Project, request: CalculationRequest): CalculationState {
  const { scanKind, displayMode, plotView } = request
  const [state, setState] = useState<CalculationState>({ curve: null, error: null, busy: true })
  const requestId = useRef(0)

  useEffect(() => {
    const id = ++requestId.current
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, busy: true }))
      calculate(computeService(), project, { scanKind, displayMode, plotView })
        .then((curve) => {
          if (id === requestId.current) setState({ curve, error: null, busy: false })
        })
        .catch((error: Error) => {
          if (id === requestId.current) setState((s) => ({ curve: s.curve, error: error.message, busy: false }))
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [project, scanKind, displayMode, plotView])

  return state
}
