import { createDefaultProject } from '../src/model/defaults'
import { test, expect } from './fixtures'

test('cell Fit toggles from mouse and keyboard, updates the parameter list, and supports undo', async ({ page }) => {
  await page.goto('/')
  const cell = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
  await cell.click({ button: 'right' })
  const item = page.getByRole('menuitemcheckbox', { name: 'Fit (On/Off)', exact: true })
  await expect(item).toHaveAttribute('aria-checked', 'false')
  await item.click()
  await expect(cell.locator('..')).toHaveClass(/fit-cell--active/)
  await page.getByRole('tab', { name: 'Fit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Parameters (1)', exact: true })).toBeVisible()
  await cell.focus()
  await cell.press('Shift+F10')
  await expect(item).toHaveAttribute('aria-checked', 'true')
  await item.click()
  await expect(page.getByRole('button', { name: 'Parameters (0)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(cell.locator('..')).toHaveClass(/fit-cell--active/)
  await cell.click({ button: 'right' })
  await item.press('Escape')
  await expect(item).toHaveCount(0)
  await expect(cell).toBeFocused()
})

test('element slab and scattering-factor Fit choices stay with their element', async ({ page }) => {
  const project = createDefaultProject()
  project.sample.mode = 'element'
  project.sample.elementProfiles = ['Co', 'Ni'].map(element => ({ element, f1: 1, f2: 2, f1Mag: 0, f2Mag: 0,
    slabs: [{ thickness: 0, density: 0.1, roughness: 3 }, { thickness: 20, density: 0.15, roughness: 3 }, { thickness: 0, density: 0, roughness: 0 }] }))
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'elements.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  for (const label of ['density of slab 1', 'f1 of Co']) {
    await page.getByRole('textbox', { name: label, exact: true }).click({ button: 'right' })
    await page.getByRole('menuitemcheckbox', { name: 'Fit (On/Off)', exact: true }).click()
  }
  await page.getByRole('tab', { name: 'Fit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Parameters (2)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next element', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'density of slab 1', exact: true }).locator('..')).not.toHaveClass(/fit-cell--active/)
  await expect(page.getByRole('textbox', { name: 'f1 of Ni', exact: true }).locator('..')).not.toHaveClass(/fit-cell--active/)
  await page.getByRole('button', { name: 'Previous element', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'density of slab 1', exact: true }).locator('..')).toHaveClass(/fit-cell--active/)
})
