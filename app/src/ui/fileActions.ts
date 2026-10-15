// Opening and saving project files in the browser.

import { ImportError, importAllFile, type ImportReport } from '../import/allFile'
import { validateProject, type Project } from '../model/project'

export interface OpenedProject {
  project: Project
  fileName: string
  report?: ImportReport
}

export async function readProjectFile(file: File): Promise<OpenedProject> {
  const name = file.name
  if (name.toLowerCase().endsWith('.all')) {
    const { project, report } = importAllFile(await file.arrayBuffer(), name)
    return { project, fileName: name.replace(/\.all$/i, '.json'), report }
  }
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new ImportError(`"${name}" is neither a ReMagX project (.json) nor a legacy state file (.all).`)
  }
  const result = validateProject(data)
  if (!result.ok) throw new ImportError(`"${name}" is not a valid ReMagX project:\n${result.issues.slice(0, 10).join('\n')}`)
  return { project: result.project, fileName: name }
}

export function downloadProject(project: Project, fileName: string): void {
  const blob = new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.json') ? fileName : `${fileName}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}
