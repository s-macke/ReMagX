import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { createDefaultProject } from '../src/model/defaults'

async function storedThickness(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remagx', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try { return await new Promise<number | undefined>(resolve => {
      const request = db.transaction('autosave').objectStore('autosave').get('current')
      request.onsuccess = () => resolve(request.result?.project.sample.layers[1].thickness)
    }) } finally { db.close() }
  })
}

for (const change of ['edit', 'open', 'new', 'empty'] as const) {
  test(`delayed recovery preserves ${change} and autosaves it for the next reload`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
      if (sessionStorage.getItem('delay-restore') !== 'yes') return
      const get = IDBObjectStore.prototype.get
      let held = false
      IDBObjectStore.prototype.get = function (key) {
        const request = get.call(this, key)
        if (this.name === 'autosave' && !held) {
          held = true
          Object.defineProperty(request, 'onsuccess', { set(callback) {
            request.addEventListener('success', event => {
              Object.assign(window, { releaseRestore: () => callback.call(request, event) })
            })
          } })
        }
        return request
      }
    })
    await page.goto('/')
    const cell = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
    await cell.fill('41'); await cell.press('Enter')
    await expect.poll(() => storedThickness(page)).toBe(41)
    if (change === 'empty') await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => {
        const request = indexedDB.open('remagx', 1); request.onsuccess = () => resolve(request.result)
      })
      try { await new Promise<void>(resolve => {
        const transaction = db.transaction('autosave', 'readwrite')
        transaction.objectStore('autosave').clear(); transaction.oncomplete = () => resolve()
      }) } finally { db.close() }
    })
    await page.evaluate(() => sessionStorage.setItem('delay-restore', 'yes'))
    await page.reload()
    await page.waitForFunction(() => 'releaseRestore' in window)
    const expected = change === 'new' ? 10 : 123
    if (change === 'open') {
      const project = createDefaultProject(); project.sample.layers[1].thickness = expected
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
      await (await chooser).setFiles({ name: 'chosen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
    } else if (change === 'new') {
      await page.getByRole('button', { name: 'File', exact: true }).click()
      await page.getByRole('menuitem', { name: 'New', exact: true }).click()
    } else { await cell.fill(String(expected)); await cell.press('Enter') }
    await expect(cell).toHaveValue(String(expected))
    await page.evaluate(() => (window as unknown as { releaseRestore: () => void }).releaseRestore())
    await expect.poll(() => storedThickness(page)).toBe(expected)
    await expect(cell).toHaveValue(String(expected))
    if (change === 'open') await expect(page.locator('.menu-bar__file')).toHaveText('chosen.json')
    if (change === 'new') await expect(page.locator('.menu-bar__file')).toHaveText('untitled.json')
    await page.evaluate(() => sessionStorage.removeItem('delay-restore'))
    await page.reload()
    await expect(cell).toHaveValue(String(expected))
    await expect(page.getByRole('status')).toContainText('Restored the last session.')
  })
}
