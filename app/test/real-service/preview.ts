import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { PlotPanel } from '../../src/ui/PlotPanel'
import { useCalculation } from '../../src/state/useCalculation'
import { fitPreviewCurve } from '../../src/model/fitPreview'
import type { Project } from '../../src/model/project'
import type { FitDatasetPreview } from '../../src/compute/ComputeService'

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
