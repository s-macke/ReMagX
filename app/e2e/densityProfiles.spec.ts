import { createDefaultProject } from '../src/model/defaults'
import { test, expect } from './fixtures'

test('density profiles report the production lookup requirement while preserving element editing and undo', async ({ page }) => {
  const project = createDefaultProject()
  project.sample.mode = 'element'
  project.sample.elementProfiles = ['Co', 'Ni'].map((element, index) => ({ element, f1: 1, f2: 2, f1Mag: 0, f2Mag: 0,
    slabs: [{ thickness: 0, density: 0.1 + index * 0.1, roughness: 0 }, { thickness: 20, density: 0.1 + index * 0.1, roughness: 0 }, { thickness: 0, density: 0.1 + index * 0.1, roughness: 0 }] }))
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Show Density Profiles', exact: true })).toHaveCount(0)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'elements.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('toolbar').getByRole('button', { name: 'Show Density Profiles', exact: true }).click()
  await expect(page.locator('.status-bar__error')).toContainText('error-function lookup')
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
  const density = page.getByRole('textbox', { name: 'density of slab 1', exact: true })
  await density.fill('0.3')
  await density.press('Enter')
  await expect(density).toHaveValue('0.3')
  await expect(page.locator('.status-bar__error')).toContainText('error-function lookup')
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(density).toHaveValue('0.1')
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  const header = page.getByRole('button', { name: 'Element Mode', exact: true })
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click()
  await page.getByRole('button', { name: 'Show Scattering Factors f1/f2', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Load Co.ff')
  await page.getByRole('button', { name: 'Show Density Profiles', exact: true }).last().click()
  await expect(page.getByRole('status')).not.toContainText('Load Co.ff')
  await expect(page.locator('.status-bar__error')).toContainText('error-function lookup')
})
