import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

async function openLibrary(page: Page) {
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  const header = page.getByRole('button', { name: 'Optical Constants Database', exact: true })
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click()
}

async function importTables(page: Page, files: { name: string; text: string }[]) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load tables…', exact: true }).click()
  await (await chooser).setFiles(files.map(file => ({ name: file.name, mimeType: 'text/plain', buffer: Buffer.from(file.text) })))
}

async function savedRecords(page: Page) {
  return page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open('remagx-materials', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('tables', 'readonly')
      const read = transaction.objectStore('tables').getAll()
      transaction.oncomplete = () => { database.close(); resolve(read.result) }
      transaction.onabort = () => { database.close(); reject(transaction.error) }
    }
  }))
}

test('all optical table kinds persist, replacements win and clear survives reload without changing the project', async ({ page }) => {
  await page.goto('/')
  await openLibrary(page)
  await importTables(page, [
    { name: 'Co.db', text: '700 1 2\n800 3 4' },
    { name: 'Co.m', text: '700 -1 0\n800 1 0' },
    { name: 'Co.ff', text: '700 5 6' },
    { name: 'Co.ffm', text: '700 7 8' },
    { name: 'Co.e', text: `700 ${Array.from({ length: 18 }, (_, index) => index).join(' ')}` },
  ])
  await expect.poll(() => savedRecords(page)).toHaveLength(5)
  await page.reload()
  await openLibrary(page)
  await expect(page.getByRole('group', { name: 'Loaded tables', exact: true }).locator('tbody tr')).toHaveCount(5)
  await importTables(page, [{ name: 'Co.db', text: '700 9 10\n800 11 12' }])
  await expect.poll(async () => JSON.stringify(await savedRecords(page))).toContain('[[9,11],[10,12]]')
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
  await page.reload()
  await openLibrary(page)
  await expect(page.getByRole('group', { name: 'Loaded tables', exact: true }).locator('tbody tr')).toHaveCount(5)
  await page.getByRole('button', { name: 'Delete optical constants cache', exact: true }).click()
  await expect.poll(() => savedRecords(page)).toHaveLength(0)
  await page.reload()
  await openLibrary(page)
  await expect(page.locator('.material-library-status')).toHaveText('Material library saved in this browser.')
  await expect(page.getByRole('group', { name: 'Loaded tables', exact: true })).toContainText('No tables loaded')
})

test('unreadable records are reported and retained until an explicit clear', async ({ page }) => {
  await page.goto('/')
  await openLibrary(page)
  await expect(page.locator('.material-library-status')).toHaveText('Material library saved in this browser.')
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('remagx-materials', 1)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('tables', 'readwrite')
      transaction.objectStore('tables').put({ version: 999, privatePayload: 'retained' }, 'future')
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onabort = () => { database.close(); reject(transaction.error) }
    }
  }))
  await page.reload()
  await openLibrary(page)
  await expect(page.getByRole('alert')).toContainText('1 stored table(s) could not be read')
  await expect(page.getByRole('button', { name: 'Delete optical constants cache', exact: true })).toBeEnabled()
  await importTables(page, [{ name: 'Co.db', text: '700 1 2' }])
  await expect.poll(() => savedRecords(page)).toHaveLength(2)
  expect(await savedRecords(page)).toContainEqual({ version: 999, privatePayload: 'retained' })
  await expect(page.getByRole('alert')).toContainText('could not be read')
  await page.getByRole('button', { name: 'Delete optical constants cache', exact: true }).click()
  await expect.poll(() => savedRecords(page)).toHaveLength(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('unavailable storage reports failures while imported tables remain usable for the session', async ({ page }) => {
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = (name, version) => {
      if (name === 'remagx-materials') throw new DOMException('Storage unavailable', 'SecurityError')
      return open(name, version)
    }
  })
  await page.goto('/')
  await openLibrary(page)
  await expect(page.getByRole('alert')).toContainText('Could not restore material library')
  await importTables(page, [{ name: 'Co.db', text: '700 1 2\n800 3 4' }])
  await expect(page.getByRole('alert')).toContainText('changes were not saved')
  await expect(page.getByRole('group', { name: 'Loaded tables', exact: true }).locator('tbody tr')).toHaveCount(1)
  await page.getByRole('textbox', { name: 'thickness of layer 1', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show δ and β spectrum', exact: true }).click()
  await expect(page.getByLabel('Plot axis: energy', { exact: true })).toBeVisible()
})
