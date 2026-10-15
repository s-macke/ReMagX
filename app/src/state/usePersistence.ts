import { useEffect, useRef } from 'react'
import { loadAutosave, saveAutosave } from './autosave'
import { useAppState, useDispatch } from './context'

const AUTOSAVE_DELAY_MS = 1000

// Restores the autosaved project on start and autosaves every change after a short pause.
export function usePersistence(): void {
  const { project, fileName, savedProject } = useAppState()
  const dispatch = useDispatch()
  const restored = useRef(false)

  useEffect(() => {
    let cancelled = false
    void loadAutosave().then((saved) => {
      restored.current = true
      if (cancelled || !saved) return
      dispatch({ type: 'loadProject', project: saved.project, fileName: saved.fileName, unsaved: true, notice: 'Restored the last session.' })
    })
    return () => {
      cancelled = true
    }
  }, [dispatch])

  useEffect(() => {
    if (!restored.current) return
    const timer = setTimeout(() => void saveAutosave(project, fileName), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [project, fileName, savedProject])
}
