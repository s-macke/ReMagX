import { useCallback } from 'react'
import { ComputeCancelled } from '../compute'
import { mergeFitResult } from '../model/mergeFitResult'
import type { FitEvent } from './appState'
import { useAppState, useDispatch } from './context'
import { computeService } from './useCalculation'

// Starts and stops fits in the compute worker and reports progress through the app state.
// When a fit ends, only the fitted quantities are written back, so edits made meanwhile survive.
export function useFitRunner() {
  const { project, fitEpoch } = useAppState()
  const dispatch = useDispatch()

  const start = useCallback(() => {
    dispatch({ type: 'setCalculationPaused', paused: false })
    const parameters = project.fit.parameters
    const epoch = fitEpoch + 1
    const report = (event: FitEvent) => dispatch({ type: 'fitEvent', epoch, event })
    const service = computeService()
    dispatch({ type: 'beginFit', parameters, workerPreviews: service.providesFitPreviews })
    dispatch({ type: 'appendDebug', lines: [`Fit started: ${project.fit.algorithm}, ${parameters.length} parameter(s)`] })
    let streamed = false
    service
      .startFit(project, (progress) => {
        report({ type: 'setFitStatus', fitStatus: { iteration: progress.iteration, chi2: progress.chi2, values: progress.values, datasetPreview: progress.datasetPreview } })
        report({ type: 'appendDebug', lines: [`Iteration: ${progress.iteration} Chi^2: ${progress.chi2.toPrecision(6)}`] })
      }, lines => {
        if (lines.length) { streamed = true; report({ type: 'appendDebug', lines }) }
      })
      .then((result) => {
        if (!streamed && result.scriptMessages?.length) report({ type: 'appendDebug', lines: result.scriptMessages })
        report({ type: 'updateProject', update: (current) => mergeFitResult(current, project, result) })
        if (result.stopped) report({ type: 'setCalculationPaused', paused: true })
        const message = result.stopped ? `Stopped after ${result.iterations} iterations.` : `Finished after ${result.iterations} iterations.`
        report({
          type: 'setFitStatus',
          fitStatus: { running: false, datasetPreview: undefined, workerPreviews: false, chi2: result.chi2, iteration: result.iterations, message, parameters: null, values: null },
        })
        report({ type: 'appendDebug', lines: [`${message} Chi^2: ${result.chi2.toPrecision(6)}`] })
      })
      .catch((error: Error) => {
        report({ type: 'setFitStatus', fitStatus: { running: false, datasetPreview: undefined, workerPreviews: false, message: error.message, parameters: null, values: null } })
        report({ type: 'appendDebug', lines: [error instanceof ComputeCancelled ? error.message : `Fit error: ${error.message}`] })
      })
  }, [project, fitEpoch, dispatch])

  const stop = useCallback(() => {
    dispatch({ type: 'setCalculationPaused', paused: true })
    computeService().stopFit()
  }, [dispatch])

  const evaluate = useCallback(() => {
    const epoch = fitEpoch + 1
    const report = (event: FitEvent) => dispatch({ type: 'fitEvent', epoch, event })
    dispatch({ type: 'beginFit', parameters: null })
    computeService()
      .calcChi2(project, lines => report({ type: 'appendDebug', lines }))
      .then((chi2) => {
        report({ type: 'setFitStatus', fitStatus: { evaluating: false, chi2, message: 'χ² of the current parameters.' } })
        report({ type: 'appendDebug', lines: [`Chi^2 of the current parameters: ${chi2.toPrecision(6)}`] })
      })
      .catch((error: Error) => report({ type: 'setFitStatus', fitStatus: { evaluating: false, message: error.message } }))
  }, [project, fitEpoch, dispatch])

  return { start, stop, evaluate }
}
