import { useEffect, useState } from 'react'
import { loadAutosave, saveAutosave } from './autosave'
import { useAppState, useDispatch } from './context'

const AUTOSAVE_DELAY_MS = 1000

// Restores the autosaved project on start and autosaves every change after a short pause.
export function usePersistence(): void {
  const state = useAppState()
  const { project, fileName, savedProject } = state
  const [source] = useState(() => ({ project, fileName, savedProject, fileSession: state.fileSession, history: state.history }))
  const dispatch = useDispatch()
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadAutosave().then((saved) => {
      if (cancelled) return
      if (saved) dispatch({ type: 'restoreAutosave', source, project: saved.project, fileName: saved.fileName })
      setRestored(true)
    })
    return () => {
      cancelled = true
    }
  }, [dispatch, source])

  useEffect(() => {
    if (!restored) return
    const timer = setTimeout(() => void saveAutosave(project, fileName), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [project, fileName, savedProject, restored])
}
