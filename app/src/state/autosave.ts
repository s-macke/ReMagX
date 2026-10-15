// Autosave of the current project in IndexedDB (spec AC-14). Per browser and origin; failures
// (private mode, quota) are ignored, the app just starts with the default project then.

import { validateProject, type Project } from '../model/project'

const DB_NAME = 'remagx'
const STORE = 'autosave'
const KEY = 'current'

interface AutosaveRecord {
  project: unknown
  fileName: string
  savedAt: number
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function saveAutosave(project: Project, fileName: string): Promise<void> {
  try {
    const record: AutosaveRecord = { project, fileName, savedAt: Date.now() }
    await withStore('readwrite', (store) => store.put(record, KEY))
  } catch {
    // Storage unavailable: autosave is best effort.
  }
}

export async function loadAutosave(): Promise<{ project: Project; fileName: string } | null> {
  try {
    const record = (await withStore('readonly', (store) => store.get(KEY))) as AutosaveRecord | undefined
    if (!record) return null
    const result = validateProject(record.project)
    return result.ok ? { project: result.project, fileName: record.fileName } : null
  } catch {
    return null
  }
}
