import { useState } from 'react'
import { importAllFile } from '../import/allFile'
import { createDefaultProject } from '../model/defaults'
import { forgetCurrentFile, openProjectInteractive, saveProjectToFile } from '../ui/fileActions'
import { useAppState, useDispatch } from './context'
import defaultExample from '../../test/fixtures/default.all?raw'
import tutorial1 from '../../test/fixtures/Tut1.all?raw'
import tutorial2 from '../../test/fixtures/Tut2.all?raw'
import tutorial3 from '../../test/fixtures/Tut3.all?raw'

export const projectExamples = [
  { label: 'Example: Co/Cu multilayer (default)', file: 'default.all', content: defaultExample },
  { label: 'Example: Tutorial 1', file: 'Tut1.all', content: tutorial1 },
  { label: 'Example: Tutorial 2 (with data)', file: 'Tut2.all', content: tutorial2 },
  { label: 'Example: Tutorial 3 (with data)', file: 'Tut3.all', content: tutorial3 },
]

// Coordinates project state changes; browser pickers and file handles stay in fileActions.
export function useProjectFileCommands() {
  const { project, fileName } = useAppState()
  const dispatch = useDispatch()
  const [error, setError] = useState<string | null>(null)

  const open = async () => {
    try {
      const opened = await openProjectInteractive()
      if (opened) dispatch({ type: 'loadProject', ...opened, unsaved: opened.report !== undefined })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const save = async (saveAs: boolean) => {
    try {
      const savedAs = await saveProjectToFile(project, fileName, saveAs)
      if (savedAs) dispatch({ type: 'markSaved', fileName: savedAs })
    } catch (e) {
      setError(`Saving failed: ${(e as Error).message}`)
    }
  }

  const newProject = () => {
    forgetCurrentFile()
    dispatch({ type: 'loadProject', project: createDefaultProject(), fileName: 'untitled.json' })
  }

  const openExample = (example: (typeof projectExamples)[number]) => {
    try {
      const { project: imported, report } = importAllFile(example.content, example.file)
      forgetCurrentFile()
      dispatch({ type: 'loadProject', project: imported, fileName: example.file.replace('.all', '.json'), report, unsaved: true })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return { open, save, newProject, openExample, error, clearError: () => setError(null) }
}
