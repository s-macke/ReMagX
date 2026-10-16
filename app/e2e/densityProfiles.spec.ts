import { createDefaultProject } from '../src/model/defaults'
import { test, expect } from './fixtures'

test('density profiles show all elements from the toolbar and Sample section, update on edits and support undo', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
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
  await expect(page.getByLabel('Plot axis: z', { exact: true })).toBeVisible()
  await expect(page.locator('.plot-panel__legend')).toContainText('Co')
  await expect(page.locator('.plot-panel__legend')).toContainText('Ni')
  const copy = async () => {
    const menu = page.locator('.plot-panel__export')
    if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
    await page.getByRole('button', { name: 'Copy data to clipboard', exact: true }).click()
    await expect(page.locator('.plot-panel__export-message')).toHaveText('Diagram data copied.')
    return page.evaluate(() => navigator.clipboard.readText())
  }
  expect(await copy()).toContain('0\t0.1\t0\t0.2')
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
  const density = page.getByRole('textbox', { name: 'density of slab 1', exact: true })
  await density.fill('0.3')
  await density.press('Enter')
  await expect.poll(copy).toContain('0\t0.2\t0\t0.2')
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect.poll(copy).toContain('0\t0.1\t0\t0.2')
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  const header = page.getByRole('button', { name: 'Element Mode', exact: true })
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click()
  await page.getByRole('button', { name: 'Show Scattering Factors f1/f2', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Load Co.ff')
  await page.getByRole('button', { name: 'Show Density Profiles', exact: true }).last().click()
  await expect(page.getByRole('status')).not.toContainText('Load Co.ff')
  expect(await copy()).toContain('0\t0.1\t0\t0.2')
})
