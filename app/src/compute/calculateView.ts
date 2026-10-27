import type { ComputeService } from './ComputeService'
import type { OpticalTable } from '../import/tables'
import type { Project } from '../model/project'
import type { DisplayMode, PlotView, ScanKind } from '../state/appState'
import type { CalculatedCurve } from '../model/plotCoordinates'
import { spectrumPlot } from '../model/spectrumView'
import { densityProfilePlot } from '../model/densityProfileView'
import { profilePlot } from '../model/profileView'
import { reflectivityPlot } from '../model/reflectivityView'
import { tensorPlot } from '../model/tensorView'

export interface CalculationRequest {
  scanKind: ScanKind
  displayMode: DisplayMode
  plotView: PlotView
  illustrateSegmentation?: boolean
  elementIndex?: number
  layerIndex?: number
  tables?: OpticalTable[]
}

// Routes a view request through the supplied service and maps its result for plotting.
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

