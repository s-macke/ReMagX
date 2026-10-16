import { useCallback } from 'react'
import { applyFitValues } from '../model/fitTargets'
import { useAppState, useDispatch } from './context'
import { computeService } from './useCalculation'

// Starts and stops fits in the compute worker and reports progress through the app state.
// When a fit ends, only the fitted quantities are written back, so edits made meanwhile survive.
export function useFitRunner() {
  const { project } = useAppState()
  const dispatch = useDispatch()

  const start = useCallback(() => {
    const parameters = project.fit.parameters
    dispatch({ type: 'setFitStatus', fitStatus: { running: true, iteration: 0, message: 'Fitting…', parameters, values: null } })
    dispatch({ type: 'appendDebug', lines: [`Fit started: ${project.fit.algorithm}, ${parameters.length} parameter(s)`] })
    computeService()
      .startFit(project, (progress) => {
        dispatch({ type: 'setFitStatus', fitStatus: { iteration: progress.iteration, chi2: progress.chi2, values: progress.values } })
        dispatch({ type: 'appendDebug', lines: [`Iteration: ${progress.iteration} Chi^2: ${progress.chi2.toPrecision(6)}`] })
      })
      .then((result) => {
        dispatch({ type: 'updateProject', update: (current) => applyFitValues(current, parameters, result.values) })
        const message = result.stopped ? `Stopped after ${result.iterations} iterations.` : `Finished after ${result.iterations} iterations.`
        dispatch({
          type: 'setFitStatus',
          fitStatus: { running: false, chi2: result.chi2, iteration: result.iterations, message, parameters: null, values: null },
        })
        dispatch({ type: 'appendDebug', lines: [`${message} Chi^2: ${result.chi2.toPrecision(6)}`] })
      })
      .catch((error: Error) => {
        dispatch({ type: 'setFitStatus', fitStatus: { running: false, message: error.message, parameters: null, values: null } })
        dispatch({ type: 'appendDebug', lines: [`Fit error: ${error.message}`] })
      })
  }, [project, dispatch])

  const stop = useCallback(() => computeService().stopFit(), [])

  const evaluate = useCallback(() => {
    computeService()
      .calcChi2(project)
      .then((chi2) => {
        dispatch({ type: 'setFitStatus', fitStatus: { chi2, message: 'χ² of the current parameters.' } })
        dispatch({ type: 'appendDebug', lines: [`Chi^2 of the current parameters: ${chi2.toPrecision(6)}`] })
      })
      .catch((error: Error) => dispatch({ type: 'setFitStatus', fitStatus: { message: error.message } }))
  }, [project, dispatch])

  return { start, stop, evaluate }
}
