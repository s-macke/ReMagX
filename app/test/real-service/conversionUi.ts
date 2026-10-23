import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { WorkerComputeService } from '../../src/compute/WorkerComputeService'
import type { ComputeService } from '../../src/compute/ComputeService'
import type { Project } from '../../src/model/project'
import { initialState, reducer, type Action } from '../../src/state/appState'
import { StateContext, DispatchContext } from '../../src/state/context'
import { SegmentationSection } from '../../src/ui/sections/SampleSections'

// Production controls and reducer with an explicitly supplied integration worker.
export function mountLayerConversion(project: Project, service: ComputeService = new WorkerComputeService()) {
  const element = document.createElement('div')
  element.id = 'conversion-test'
  document.body.append(element)
  const root = createRoot(element)
  let state = { ...initialState(), project: structuredClone(project) }
  const dispatch = (action: Action) => { state = reducer(state, action); render() }
  function render() {
    flushSync(() => root.render(createElement(StateContext.Provider, { value: state },
      createElement(DispatchContext.Provider, { value: dispatch },
        createElement(SegmentationSection, { service })))))
  }
  render()
  return {
    snapshot() { return structuredClone(state) },
    dispatch,
    dispose() { flushSync(() => root.unmount()); element.remove(); service.dispose() },
  }
}
