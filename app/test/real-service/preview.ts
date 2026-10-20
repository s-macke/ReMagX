import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { PlotPanel } from '../../src/ui/PlotPanel'
import { useCalculation } from '../../src/state/useCalculation'
import { fitPreviewCurve } from '../../src/model/fitPreview'
import type { Project } from '../../src/model/project'
import type { FitDatasetPreview } from '../../src/compute/ComputeService'
import type { ReflectivityCurve } from '../../src/compute/ComputeService'
import { reflectivityPlot } from '../../src/model/reflectivityView'
import { plotCoordinates } from '../../src/model/plotCoordinates'
import { measuredSeries } from '../../src/model/datasets'

export function renderFourierPlot(project: Project, result: ReflectivityCurve) {
  const element = document.createElement('div')
  element.style.cssText = 'width:800px;height:500px'
  document.body.append(element)
  const root = createRoot(element)
  try {
    const plot = plotCoordinates(reflectivityPlot(result, project),
      measuredSeries(project, 'monochromatic', 'qz'), true, project.experiment.energy)
    flushSync(() => root.render(createElement(PlotPanel, { curve: plot.curve, measured: plot.measured })))
    return { axis: element.querySelector('[aria-label="Plot axis: depth"]') !== null,
      canvases: element.querySelectorAll('canvas').length, text: element.textContent,
      measured: plot.measured, x: plot.curve?.x }
  } finally { flushSync(() => root.unmount()); element.remove() }
}

// Render the production plot and calculation hook while a real worker owns fitting.
export function mountFitPreview(project: Project) {
  const element = document.createElement('div')
  element.style.cssText = 'width:800px;height:500px'
  document.body.append(element)
  const root = createRoot(element)
  function Preview({ preview }: { preview?: FitDatasetPreview }) {
    useCalculation(project, { scanKind: 'reflectivity', displayMode: 'monochromatic', plotView: 'scan' }, true)
    return createElement(PlotPanel, { measured: [], curve: fitPreviewCurve(preview, project.activeDatasetIndex, 'qz', 'monochromatic') })
  }
  flushSync(() => root.render(createElement(Preview)))
  return {
    update(preview?: FitDatasetPreview) { flushSync(() => root.render(createElement(Preview, { preview }))) },
    rendered() { return { canvases: element.querySelectorAll('canvas').length, text: element.textContent } },
    dispose() { flushSync(() => root.unmount()); element.remove() },
  }
}
