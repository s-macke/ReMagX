import type { OpticalTable } from '../import/tables'
import { opticalTableKey, readStoredOpticalTable } from '../model/materialLibrary'

const DATABASE = 'remagx-materials'
const STORE = 'tables'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('Close other ReMagX tabs to upgrade the material library.')) }
    request.onsuccess = () => {
      const database = request.result
      if (blocked) { database.close(); return }
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

export async function loadMaterialLibrary(): Promise<{ tables: OpticalTable[]; unreadable: number }> {
  const database = await openDatabase()
  try {
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).getAll()
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? new Error('Reading the material library was interrupted.'))
      transaction.onerror = () => reject(transaction.error)
    })
    const tables = records.map(readStoredOpticalTable)
    return { tables: tables.filter((table): table is OpticalTable => table !== null), unreadable: tables.filter(table => table === null).length }
  } finally { database.close() }
}

// Upsert instead of replacing the store, so unreadable/future-version records are
// preserved. Only the explicit clear-library action removes stored records.
export async function saveMaterialLibrary(tables: OpticalTable[], clear: boolean): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving the material library was interrupted.'))
      transaction.onerror = () => reject(transaction.error)
      const store = transaction.objectStore(STORE)
      if (clear) store.clear()
      for (const table of tables) store.put({ version: 1, table }, opticalTableKey(table))
    })
  } finally { database.close() }
}
