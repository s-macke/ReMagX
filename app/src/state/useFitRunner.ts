import { useCallback } from 'react'
import { useAppState, useDispatch } from './context'
import { computeService } from './useCalculation'

// Starts and stops fits in the compute worker and reports progress through the app state.
// When a fit ends, its best parameter values are written back into the project.
export function useFitRunner() {
  const { project } = useAppState()
  const dispatch = useDispatch()

  const start = useCallback(() => {
    dispatch({ type: 'setFitStatus', fitStatus: { running: true, iteration: 0, message: 'Fitting…' } })
    computeService()
      .startFit(project, (progress) => dispatch({ type: 'setFitStatus', fitStatus: { iteration: progress.iteration, chi2: progress.chi2 } }))
      .then((result) => {
        dispatch({ type: 'updateProject', update: () => result.project })
        dispatch({
          type: 'setFitStatus',
          fitStatus: {
            running: false,
            chi2: result.chi2,
            iteration: result.iterations,
            message: result.stopped ? `Stopped after ${result.iterations} iterations.` : `Finished after ${result.iterations} iterations.`,
          },
        })
      })
      .catch((error: Error) => dispatch({ type: 'setFitStatus', fitStatus: { running: false, message: error.message } }))
  }, [project, dispatch])

  const stop = useCallback(() => computeService().stopFit(), [])

  const evaluate = useCallback(() => {
    computeService()
      .calcChi2(project)
      .then((chi2) => dispatch({ type: 'setFitStatus', fitStatus: { chi2, message: 'χ² of the current parameters.' } }))
      .catch((error: Error) => dispatch({ type: 'setFitStatus', fitStatus: { message: error.message } }))
  }, [project, dispatch])

  return { start, stop, evaluate }
}
