import { useEffect, useRef } from 'react'
import { useAppState, useDispatch } from './context'
import { loadMaterialLibrary, saveMaterialLibrary } from './materialLibraryStorage'

export function useMaterialLibrary(): void {
  const { opticalTables, materialLibrary } = useAppState()
  const dispatch = useDispatch()
  const queue = useRef(Promise.resolve())
  const savedReset = useRef(0)
  useEffect(() => {
    let cancelled = false
    void loadMaterialLibrary().then(({ tables, unreadable }) => {
      if (!cancelled) dispatch({ type: 'restoreOpticalTables', tables,
        error: null, warning: unreadable ? `${unreadable} stored table(s) could not be read. Their records remain stored until you clear the library.` : null })
    }).catch(error => {
      if (!cancelled) dispatch({ type: 'restoreOpticalTables', tables: [], error: `Could not restore material library: ${String(error)}` })
    })
    return () => { cancelled = true }
  }, [dispatch])

  const { ready, revision, resetVersion } = materialLibrary
  useEffect(() => {
    if (!ready || revision === 0) return
    queue.current = queue.current.then(async () => {
      await saveMaterialLibrary(opticalTables, resetVersion > savedReset.current)
      savedReset.current = resetVersion
      dispatch({ type: 'materialLibrarySaved', revision })
    }).catch(error => dispatch({ type: 'materialLibraryFailed', revision, error: `Material library changes were not saved: ${String(error)}` }))
  }, [opticalTables, ready, revision, resetVersion, dispatch])
}
