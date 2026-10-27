import { useCallback } from 'react'
import { useAppState, useDispatch } from './context'
import { computeService } from '../compute/sharedComputeService'

let nextRequestId = 0

export function useDatabaseUpdate() {
  const { project, opticalTables, fitEpoch, databaseUpdate } = useAppState()
  const dispatch = useDispatch()
  return useCallback(() => {
    if (databaseUpdate.busy) return
    const id = ++nextRequestId
    dispatch({ type: 'beginDatabaseUpdate', id })
    void computeService().databaseValues(project, opticalTables).then(result => {
      dispatch({ type: 'completeDatabaseUpdate', id, source: project, tables: opticalTables, epoch: fitEpoch, result })
    }).catch((error: Error) => dispatch({ type: 'failDatabaseUpdate', id, error: error.message }))
  }, [databaseUpdate.busy, dispatch, project, opticalTables, fitEpoch])
}
