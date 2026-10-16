import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures'
import { createDefaultProject } from '../src/model/defaults'
import type { Page } from '@playwright/test'

async function editThickness(page: Page, value: string) {
  const cell = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
  await cell.fill(value)
  await cell.press('Enter')
  await expect(cell).toHaveValue(value)
}

test('AC-11: every current section toggles; algorithm visibility and expansion persist', async ({ page }) => {
  await page.goto('/')
  for (const tab of ['Experiment', 'Sample', 'Fit']) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    const headers = page.locator('.section__header')
    for (const header of await headers.all()) {
      const id = await header.getAttribute('aria-controls')
      await header.click()
      await expect(page.locator(`#${id}`)).toBeVisible()
      await header.click()
      await expect(page.locator(`#${id}`)).toHaveCount(0)
    }
  }
  await page.getByRole('button', { name: 'Algorithm', exact: true }).click()
  const parameters = page.getByRole('button', { name: 'Algorithm Parameters', exact: true })
  await expect(parameters).toHaveCount(0)
  await page.getByRole('radio', { name: 'Simplex with simulated annealing', exact: true }).check()
  await parameters.click()
  await expect(page.locator('#section-fit-algorithm-parameters')).toBeVisible()
  await parameters.click()
  await page.getByRole('radio', { name: 'Simplex', exact: true }).check()
  await expect(parameters).toHaveCount(0)
  await page.getByRole('radio', { name: 'Simplex with simulated annealing', exact: true }).check()
  await expect(parameters).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await page.getByRole('tab', { name: 'Fit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Algorithm', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Fitting Window', exact: true })).toHaveAttribute('aria-expanded', 'false')
})

test('AC-14: an edited layer is restored from IndexedDB after reload', async ({ page }) => {
  await page.goto('/')
  await editThickness(page, '37.125')
  // Wait for the actual persisted record, not a sleep approximating the debounce.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remagx', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<boolean>(resolve => {
        const request = db.transaction('autosave').objectStore('autosave').get('current')
        request.onsuccess = () => resolve(request.result?.project.sample.layers[1].thickness === 37.125)
      })
    } finally { db.close() }
  })).toBe(true)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })).toHaveValue('37.125')
  await expect(page.getByRole('status')).toContainText('Restored the last session.')
})

test('AC-15: upload and download round-trip with picker APIs unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })
  })
  await page.goto('/')
  const project = createDefaultProject()
  project.sample.layers[1].thickness = 42
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })).toHaveValue('42')
  await editThickness(page, '43')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('roundtrip.json')
  project.sample.layers[1].thickness = 43
  expect(JSON.parse(await readFile((await file.path())!, 'utf8'))).toEqual(project)
})

test('AC-15: real file handles support Open, Save and Save As', async ({ page }) => {
  const project = createDefaultProject()
  project.sample.layers[1].thickness = 42
  // Native picker dialogs cannot run headlessly. Supply real OPFS handles at that boundary;
  // getFile/createWritable/write/close are browser implementations, not mocks.
  await page.addInitScript(project => {
    const handle = async (name: string) => (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    window.showOpenFilePicker = async () => {
      const file = await handle('opened.json')
      const stream = await file.createWritable()
      await stream.write(JSON.stringify(project))
      await stream.close()
      return [file]
    }
    window.showSaveFilePicker = async () => handle('saved-as.json')
  }, project)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })).toHaveValue('42')
  await editThickness(page, '44')
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
  const readProject = (name: string) => page.evaluate(async name => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle(name)
    const text = await (await file.getFile()).text()
    return text ? JSON.parse(text) : null
  }, name)
  project.sample.layers[1].thickness = 44
  await expect.poll(() => readProject('opened.json')).toEqual(project)
  await editThickness(page, '45')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: /Save As/ }).click()
  project.sample.layers[1].thickness = 45
  await expect.poll(() => readProject('saved-as.json')).toEqual(project)
  project.sample.layers[1].thickness = 44
  expect(await readProject('opened.json')).toEqual(project)
})
