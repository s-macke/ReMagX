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

export function chooseFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = true
    input.addEventListener('change', () => resolve([...(input.files ?? [])]))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

// --- File System Access API (Chromium) with download/upload fallback (spec AC-15) ------------

const PROJECT_TYPES: FilePickerAcceptType[] = [
  { description: 'ReMagX project or legacy state file', accept: { 'application/json': ['.json'], 'text/plain': ['.all'] } },
]
const JSON_TYPES: FilePickerAcceptType[] = [{ description: 'ReMagX project', accept: { 'application/json': ['.json'] } }]

// The file the current project was opened from or last saved to (JSON only; a legacy .all
// file is never overwritten).
let currentHandle: FileSystemFileHandle | null = null

export function forgetCurrentFile(): void {
  currentHandle = null
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

export async function openProjectInteractive(): Promise<OpenedProject | null> {
  if (!window.showOpenFilePicker) {
    const file = await chooseFile('.all,.json')
    if (!file) return null
    currentHandle = null
    return readProjectFile(file)
  }
  try {
    const [handle] = await window.showOpenFilePicker({ types: PROJECT_TYPES })
    const opened = await readProjectFile(await handle.getFile())
    currentHandle = handle.name.toLowerCase().endsWith('.json') ? handle : null
    return opened
  } catch (error) {
    if (isAbort(error)) return null
    throw error
  }
}

async function writeToHandle(handle: FileSystemFileHandle, project: Project): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(project, null, 1))
  await writable.close()
}

// Saves the project. Returns the file name it was saved under, or null if the user cancelled.
export async function saveProjectToFile(project: Project, fileName: string, saveAs: boolean): Promise<string | null> {
  try {
    if (!saveAs && currentHandle) {
      await writeToHandle(currentHandle, project)
      return currentHandle.name
    }
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ types: JSON_TYPES, suggestedName: fileName.endsWith('.json') ? fileName : `${fileName}.json` })
      await writeToHandle(handle, project)
      currentHandle = handle
      return handle.name
    }
    downloadProject(project, fileName)
    return fileName
  } catch (error) {
    if (isAbort(error)) return null
    throw error
  }
}

export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
