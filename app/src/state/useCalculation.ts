// Recalculates the curve for the current view whenever the project or view changes, debounced so
// that typing does not flood the worker. Stale results (from an older request) are discarded.

import { useEffect, useRef, useState } from 'react'
import { WorkerComputeService, type ComputeService } from '../compute'
import type { Project } from '../model/project'
import type { DisplayMode, ScanKind } from './appState'

export interface CurveSeries {
  label: string
  y: number[]
}

export interface CalculatedCurve {
  axis: 'qz' | 'energy'
  x: number[]
  series: CurveSeries[]
  logScale: boolean
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

async function calculate(service: ComputeService, project: Project, scanKind: ScanKind, mode: DisplayMode): Promise<CalculatedCurve> {
  if (mode === 'sensitivity') throw new Error('The sensitivity view is not available yet.')
  if (scanKind === 'energyScan') {
    if (mode !== 'monochromatic') throw new Error('Dichroic and asymmetry energy scans are not available in the mock engine yet.')
    const scan = await service.calcEnergyScan(project)
    return { axis: 'energy', x: scan.energy, series: [{ label: 'simulated R', y: scan.reflectivity }], logScale: true }
  }
  if (mode === 'monochromatic') {
    const curve = await service.calcReflectivity(project)
    return { axis: 'qz', x: curve.qz, series: [{ label: 'simulated R', y: curve.reflectivity }], logScale: true }
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
    }
  }
  return { axis: 'qz', x: curve.qz, series: [{ label: 'simulated asymmetry', y: curve.asymmetry }], logScale: false }
}

export function useCalculation(project: Project, scanKind: ScanKind, mode: DisplayMode): CalculationState {
  const [state, setState] = useState<CalculationState>({ curve: null, error: null, busy: true })
  const requestId = useRef(0)

  useEffect(() => {
    const id = ++requestId.current
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, busy: true }))
      calculate(computeService(), project, scanKind, mode)
        .then((curve) => {
          if (id === requestId.current) setState({ curve, error: null, busy: false })
        })
        .catch((error: Error) => {
          if (id === requestId.current) setState((s) => ({ curve: s.curve, error: error.message, busy: false }))
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [project, scanKind, mode])

  return state
}
