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
  await expect(page.getByRole('status')).toContainText('Saved opened.json.')
  expect(await readProject('opened.json')).toEqual(project)
  await editThickness(page, '45')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: /Save As/ }).click()
  project.sample.layers[1].thickness = 45
  await expect(page.getByRole('status')).toContainText('Saved saved-as.json.')
  expect(await readProject('saved-as.json')).toEqual(project)
  project.sample.layers[1].thickness = 44
  expect(await readProject('opened.json')).toEqual(project)
})

test('numeric editing and saving preserve all double digits', async ({ page }) => {
  const project = createDefaultProject()
  project.sample.layers[1].thickness = 1.2345678901234567
  project.sample.layers[1].delta = 1.2345678901234567e-8
  await page.addInitScript(project => {
    window.showOpenFilePicker = async () => {
      const file = await (await navigator.storage.getDirectory()).getFileHandle('precision.json', { create: true })
      const stream = await file.createWritable()
      await stream.write(JSON.stringify(project)); await stream.close()
      return [file]
    }
  }, project)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  const thickness = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
  const delta = page.getByRole('textbox', { name: 'δ of layer 1', exact: true })
  await expect(thickness).toHaveValue('1.2345678901234567')
  await expect(delta).toHaveValue('1.2345678901234567e-8')
  await delta.focus(); await delta.press('Tab')
  // Editing the final digit must start from the full displayed value.
  await thickness.focus(); await thickness.press('End'); await thickness.press('Backspace')
  await thickness.press('9'); await thickness.press('Enter')
  project.sample.layers[1].thickness = 1.234567890123457
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Saved precision.json.')
  const saved = await page.evaluate(async () => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle('precision.json')
    return JSON.parse(await (await file.getFile()).text())
  })
  expect(saved).toEqual(project)
})

test('obsolete Fourier setting stays readable, is reported, and can be removed with undo', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })
  })
  await page.goto('/')
  const project = createDefaultProject()
  project.calculation.automaticOpticalConstants = false
  project.calculation.postProcessing.fourierTransform = true
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'old-fourier.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.locator('.status-bar__error')).toContainText('Fourier transformation is excluded')
  await page.getByRole('tab', { name: 'Experiment', exact: true }).click()
  const section = page.getByRole('button', { name: 'Simulation Parameters', exact: true })
  if (await section.getAttribute('aria-expanded') !== 'true') await section.click()
  await expect(page.getByRole('checkbox', { name: 'Fourier transformation', exact: true })).toHaveCount(0)
  const remove = page.getByRole('button', { name: 'Remove obsolete Fourier setting', exact: true })
  await expect(remove).toBeVisible()
  await remove.click()
  await expect(remove).toHaveCount(0)
  await expect(page.locator('.status-bar__error')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(remove).toBeVisible()
  await expect(page.locator('.status-bar__error')).toContainText('Fourier transformation is excluded')
  await remove.click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
  const saved = await download
  project.calculation.postProcessing.fourierTransform = false
  expect(JSON.parse(await readFile((await saved.path())!, 'utf8'))).toEqual(project)
})

test('project file commands preserve cancellation and reset save handles for New and examples', async ({ page }) => {
  const project = createDefaultProject()
  project.sample.layers[1].thickness = 42
  await page.addInitScript(project => {
    window.showOpenFilePicker = async () => {
      const handle = await (await navigator.storage.getDirectory()).getFileHandle('original.json', { create: true })
      const stream = await handle.createWritable()
      await stream.write(JSON.stringify(project)); await stream.close()
      return [handle]
    }
    window.showSaveFilePicker = async options =>
      (await navigator.storage.getDirectory()).getFileHandle(options?.suggestedName ?? 'saved.json', { create: true })
  }, project)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await expect(page.locator('.menu-bar__file')).toHaveText('original.json')
  await editThickness(page, '43')
  await page.evaluate(() => {
    window.showOpenFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError') }
    window.showSaveFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError') }
  })
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: /Save As/ }).click()
  await expect(page.locator('.menu-bar__file')).toHaveText('original.json • unsaved')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
  await expect(page.locator('.menu-bar__file')).toHaveText('original.json')

  await page.evaluate(() => {
    window.showSaveFilePicker = async options =>
      (await navigator.storage.getDirectory()).getFileHandle(options?.suggestedName ?? 'saved.json', { create: true })
  })
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.locator('.menu-bar__file')).toHaveText('untitled.json')
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Saved untitled.json.')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Example: Co/Cu multilayer (default)', exact: true }).click()
  await expect(page.locator('.menu-bar__file')).toHaveText('default.json • unsaved')
  await page.getByRole('dialog', { name: 'Imported default.all', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Saved default.json.')
  const saved = await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory()
    const read = async (name: string) => JSON.parse(await (await (await directory.getFileHandle(name)).getFile()).text())
    return { original: await read('original.json'), fresh: await read('untitled.json'), example: await read('default.json') }
  })
  project.sample.layers[1].thickness = 43
  expect(saved.original).toEqual(project)
  expect(saved.fresh).toEqual(createDefaultProject())
  expect(saved.example.sample.layers.length).toBeGreaterThan(2)
})
